//! A real OpenZeppelin smart account in the Soroban test environment, with `ambit-policy` and the
//! stock spending-limit policy installed on a mandate rule.
//!
//! Nothing here mocks authorization for the account. Every call that needs the account's
//! approval carries an auth entry signed with a real ed25519 key, so the account runs its own
//! `__check_auth`: rule selection, the ed25519 verifier, then each policy's `enforce`.
//!
//! The account, verifier and spending-limit contracts are the stock builds in `testdata/`, the
//! same WASM as the deployments listed in `config/networks.json`.

#![allow(dead_code)]

extern crate std;

use std::cell::Cell;

use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{
    auth::{Context, ContractContext},
    map,
    testutils::EnvTestConfig,
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec,
    xdr::{
        self, HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs, Limits,
        ScVal, SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanAuthorizedFunction,
        SorobanAuthorizedInvocation, SorobanCredentials, VecM, WriteXdr,
    },
    Address, Bytes, BytesN, Env, IntoVal, Map, String, Symbol, TryFromVal, Val, Vec,
};

use ambit_policy::{AmbitParams, AmbitPolicy, AmbitPolicyClient};

pub mod oz_account {
    soroban_sdk::contractimport!(file = "testdata/oz_smart_account.wasm");
}
pub mod oz_verifier {
    soroban_sdk::contractimport!(file = "testdata/oz_ed25519_verifier.wasm");
}
pub mod oz_spending_limit {
    soroban_sdk::contractimport!(file = "testdata/oz_spending_limit.wasm");
}

use oz_account::{AuthDigestPreimage, AuthPayload, ContextRuleType, Signer};

/// One day of ledgers at 5 s each.
pub const DAY: u32 = 17_280;
/// `1h` period, in ledgers.
pub const PERIOD: u32 = 720;
/// 1 USDC in stroops.
pub const USDC: i128 = 10_000_000;
/// Cap per payment on the mandate rule.
pub const CAP: i128 = 10 * USDC;
/// Cap per period on the mandate rule.
pub const PERIOD_CAP: i128 = 25 * USDC;
/// Balance the account starts with.
pub const START_BALANCE: i128 = 1_000 * USDC;
/// The Default rule the account constructor creates for the owner.
pub const OWNER_RULE: u32 = 0;

/// An ed25519 key and the External signer the account knows it as.
pub struct Key {
    signing: SigningKey,
    pub signer: Signer,
}

impl Key {
    fn new(env: &Env, verifier: &Address, seed: u8) -> Self {
        let signing = SigningKey::from_bytes(&[seed; 32]);
        let public = Bytes::from_array(env, signing.verifying_key().as_bytes());
        Key {
            signing,
            signer: Signer::External(verifier.clone(), public),
        }
    }

    fn sign(&self, env: &Env, message: &BytesN<32>) -> Bytes {
        Bytes::from_array(env, &self.signing.sign(&message.to_array()).to_bytes())
    }
}

/// What the owner sets on the mandate rule.
#[derive(Clone)]
pub struct Mandate {
    pub payees: std::vec::Vec<Address>,
    pub max_per_payment: i128,
    pub period_cap: i128,
    pub valid_until: Option<u32>,
}

pub struct Signed {
    pub signature_payload: BytesN<32>,
    pub payload: Val,
    pub entry: SorobanAuthorizationEntry,
}

pub struct World {
    pub env: Env,
    pub account: Address,
    pub owner: Key,
    pub agent: Key,
    /// A key the account does not know.
    pub stranger: Key,
    pub usdc: Address,
    /// A second asset the account holds, with no rule for it.
    pub other_token: Address,
    pub policy: Address,
    pub spending_limit: Address,
    /// The mandate rule, once installed.
    pub rule_id: u32,
    pub payee: Address,
    nonce: Cell<i64>,
}

impl World {
    /// An account owned by `owner`, holding USDC and another token, with no mandate yet.
    pub fn empty() -> Self {
        // No test snapshots: they would embed the three stock WASM files on every test, and the
        // property test would write a new random one on each run.
        let env = Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        // Keep every entry alive while tests move the ledger forward by days.
        env.ledger().with_mut(|l| {
            l.sequence_number = 1_000;
            l.min_persistent_entry_ttl = 10 * DAY * 30;
            l.min_temp_entry_ttl = 10 * DAY * 30;
            l.max_entry_ttl = 12 * DAY * 30;
        });

        let verifier = env.register(oz_verifier::WASM, ());
        let owner = Key::new(&env, &verifier, 1);
        let agent = Key::new(&env, &verifier, 2);
        let stranger = Key::new(&env, &verifier, 3);

        let account = env.register(
            oz_account::WASM,
            (
                vec![&env, owner.signer.clone()],
                Map::<Address, Val>::new(&env),
            ),
        );
        let policy = env.register(AmbitPolicy, ());
        let spending_limit = env.register(oz_spending_limit::WASM, ());

        let usdc = new_token(&env, &account);
        let other_token = new_token(&env, &account);
        let payee = Address::generate(&env);

        World {
            env,
            account,
            owner,
            agent,
            stranger,
            usdc,
            other_token,
            policy,
            spending_limit,
            rule_id: u32::MAX,
            payee,
            nonce: Cell::new(0),
        }
    }

    /// An account with the default mandate: one payee, `CAP` per payment, `PERIOD_CAP` per
    /// `PERIOD`, valid for one day.
    pub fn new() -> Self {
        let mut w = Self::empty();
        let valid_until = Some(w.env.ledger().sequence() + DAY);
        w.install(&Mandate {
            payees: std::vec![w.payee.clone()],
            max_per_payment: CAP,
            period_cap: PERIOD_CAP,
            valid_until,
        });
        w
    }

    /// The owner adds the mandate rule with `ambit-policy`, then adds the spending limit as a
    /// second policy so the two run in that order.
    pub fn install(&mut self, m: &Mandate) {
        let env = &self.env;
        let params = AmbitParams {
            mandate_hash: BytesN::from_array(env, &[7; 32]),
            max_per_payment: m.max_per_payment,
            payees: Vec::from_slice(env, &m.payees),
        };
        let policies: Map<Address, Val> = map![env, (self.policy.clone(), params.into_val(env))];
        let args: Vec<Val> = vec![
            env,
            ContextRuleType::CallContract(self.usdc.clone()).into_val(env),
            String::from_str(env, "ambit:test").into_val(env),
            m.valid_until.into_val(env),
            vec![env, self.agent.signer.clone()].into_val(env),
            policies.into_val(env),
        ];
        self.sign_as(
            &self.owner,
            OWNER_RULE,
            &self.account,
            "add_context_rule",
            &args,
        );
        let rule = self.account().add_context_rule(
            &ContextRuleType::CallContract(self.usdc.clone()),
            &String::from_str(env, "ambit:test"),
            &m.valid_until,
            &vec![env, self.agent.signer.clone()],
            &policies,
        );
        self.rule_id = rule.id;

        let limit = oz_spending_limit::SpendingLimitAccountParams {
            spending_limit: m.period_cap,
            period_ledgers: PERIOD,
        };
        let args: Vec<Val> = vec![
            env,
            rule.id.into_val(env),
            self.spending_limit.into_val(env),
            limit.into_val(env),
        ];
        self.sign_as(&self.owner, OWNER_RULE, &self.account, "add_policy", &args);
        self.account()
            .add_policy(&rule.id, &self.spending_limit, &limit.into_val(env));
    }

    pub fn account(&self) -> oz_account::Client<'_> {
        oz_account::Client::new(&self.env, &self.account)
    }

    pub fn policy(&self) -> AmbitPolicyClient<'_> {
        AmbitPolicyClient::new(&self.env, &self.policy)
    }

    pub fn spending_limit(&self) -> oz_spending_limit::Client<'_> {
        oz_spending_limit::Client::new(&self.env, &self.spending_limit)
    }

    pub fn balance(&self, token: &Address, who: &Address) -> i128 {
        TokenClient::new(&self.env, token).balance(who)
    }

    /// Payments recorded by the spending limit in the current period.
    pub fn spent(&self) -> i128 {
        self.spending_limit()
            .get_spending_limit_data(&self.rule_id, &self.account)
            .cached_total_spent
    }

    /// Replaces the auth entries for the next call with one entry, signed by `key`, that lets
    /// the account authorize `contract.fn_name(args)` under rule `rule_id`.
    pub fn sign_as(
        &self,
        key: &Key,
        rule_id: u32,
        contract: &Address,
        fn_name: &str,
        args: &Vec<Val>,
    ) {
        let signed = self.sign(key, rule_id, contract, fn_name, args);
        self.env.set_auths(&[signed.entry]);
    }

    /// Signs `contract.fn_name(args)` as the host would ask the account to: the host payload,
    /// then the OpenZeppelin digest over it, signed by `key` for rule `rule_id`.
    pub fn sign(
        &self,
        key: &Key,
        rule_id: u32,
        contract: &Address,
        fn_name: &str,
        args: &Vec<Val>,
    ) -> Signed {
        let env = &self.env;
        let nonce = self.nonce.get() + 1;
        self.nonce.set(nonce);
        let expiration = env.ledger().sequence() + 100;

        let invocation = SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address: contract.into(),
                function_name: fn_name.try_into().unwrap(),
                args: args
                    .iter()
                    .map(|v| ScVal::try_from_val(env, &v).unwrap())
                    .collect::<std::vec::Vec<_>>()
                    .try_into()
                    .unwrap(),
            }),
            sub_invocations: VecM::default(),
        };

        // What the host passes to `__check_auth` as `signature_payload`.
        let host_preimage =
            HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
                network_id: xdr::Hash(env.ledger().get().network_id),
                nonce,
                signature_expiration_ledger: expiration,
                invocation: invocation.clone(),
            });
        let host_bytes = host_preimage.to_xdr(Limits::none()).unwrap();
        let signature_payload = env
            .crypto()
            .sha256(&Bytes::from_slice(env, &host_bytes))
            .to_bytes();

        // What an External signer signs: the account, the payload and the selected rules.
        let rule_ids = vec![env, rule_id];
        let digest_preimage = AuthDigestPreimage {
            account: self.account.clone(),
            signature_payload: signature_payload.clone(),
            context_rule_ids: rule_ids.clone(),
        };
        let digest = env
            .crypto()
            .sha256(&soroban_sdk::xdr::ToXdr::to_xdr(digest_preimage, env))
            .to_bytes();

        let payload = AuthPayload {
            signers: map![env, (key.signer.clone(), key.sign(env, &digest))],
            context_rule_ids: rule_ids,
        };
        let payload: Val = payload.into_val(env);
        let entry = SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: (&self.account).into(),
                nonce,
                signature_expiration_ledger: expiration,
                signature: ScVal::try_from_val(env, &payload).unwrap(),
            }),
            root_invocation: invocation,
        };
        Signed {
            signature_payload,
            payload,
            entry,
        }
    }

    /// Runs the account's `__check_auth` for `token.fn_name(args)` signed by `key`, the way the
    /// host does during a payment, and returns the contract error it stopped with. This is how
    /// a test sees which check refused: a refused `transfer` itself only reports a failed
    /// authorization.
    ///
    /// On success the policies' state changes are kept, as in a real payment.
    pub fn refusal(
        &self,
        key: &Key,
        token: &Address,
        fn_name: &str,
        args: Vec<Val>,
    ) -> Option<u32> {
        self.refusal_on(key, self.rule_id, token, fn_name, args)
    }

    /// `refusal` with an explicit rule and any target contract.
    pub fn refusal_on(
        &self,
        key: &Key,
        rule_id: u32,
        contract: &Address,
        fn_name: &str,
        args: Vec<Val>,
    ) -> Option<u32> {
        let signed = self.sign(key, rule_id, contract, fn_name, &args);
        let context = Context::Contract(ContractContext {
            contract: contract.clone(),
            fn_name: Symbol::new(&self.env, fn_name),
            args,
        });
        match self
            .env
            .try_invoke_contract_check_auth::<soroban_sdk::Error>(
                &self.account,
                &signed.signature_payload,
                signed.payload,
                &vec![&self.env, context],
            ) {
            Ok(()) => None,
            Err(Ok(e)) => Some(e.get_code()),
            Err(Err(e)) => panic!("not a contract error: {e:?}"),
        }
    }

    /// The agent signs and sends `token.transfer(account, to, amount)` on the mandate rule.
    /// Returns whether the payment went through.
    pub fn pay(&self, to: &Address, amount: i128) -> bool {
        self.call_token(
            &self.agent,
            &self.usdc,
            "transfer",
            self.transfer_args(to, amount),
        )
    }

    pub fn transfer_args(&self, to: &Address, amount: i128) -> Vec<Val> {
        vec![
            &self.env,
            self.account.into_val(&self.env),
            to.into_val(&self.env),
            amount.into_val(&self.env),
        ]
    }

    /// `key` signs `token.fn_name(args)` on the mandate rule and the call is sent. Returns
    /// whether it went through.
    pub fn call_token(&self, key: &Key, token: &Address, fn_name: &str, args: Vec<Val>) -> bool {
        self.sign_as(key, self.rule_id, token, fn_name, &args);
        self.env
            .try_invoke_contract::<Val, soroban_sdk::Error>(
                token,
                &Symbol::new(&self.env, fn_name),
                args,
            )
            .is_ok()
    }

    /// Moves the ledger forward.
    pub fn advance(&self, ledgers: u32) {
        self.env.ledger().with_mut(|l| l.sequence_number += ledgers);
    }
}

/// A Stellar Asset Contract with `START_BALANCE` minted to `holder`. Only the mint uses mocked
/// auth, for the issuer, before any test runs.
fn new_token(env: &Env, holder: &Address) -> Address {
    let issuer = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(issuer.clone());
    let token = sac.address();
    env.mock_auths(&[MockAuth {
        address: &issuer,
        invoke: &MockAuthInvoke {
            contract: &token,
            fn_name: "mint",
            args: (holder, START_BALANCE).into_val(env),
            sub_invokes: &[],
        },
    }]);
    StellarAssetClient::new(env, &token).mint(holder, &START_BALANCE);
    env.set_auths(&[]);
    token
}
