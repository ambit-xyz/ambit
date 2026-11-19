extern crate std;

use soroban_sdk::{
    auth::{Context, ContractContext, ContractExecutable, CreateContractHostFnContext},
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, BytesN, Env, Error, Event, IntoVal, String, Symbol, Val, Vec,
};
use stellar_accounts::smart_account::{ContextRule, ContextRuleType};

use crate::{
    events::{Installed, Uninstalled},
    storage, AmbitError, AmbitParams, AmbitPolicy, AmbitPolicyClient, MAX_PAYEES,
};

struct Setup {
    env: Env,
    policy: AmbitPolicyClient<'static>,
    account: Address,
    usdc: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AmbitPolicy, ());
    let policy = AmbitPolicyClient::new(&env, &id);
    let account = Address::generate(&env);
    let usdc = Address::generate(&env);
    Setup {
        env,
        policy,
        account,
        usdc,
    }
}

fn rule(s: &Setup, id: u32, context_type: ContextRuleType) -> ContextRule {
    ContextRule {
        id,
        context_type,
        name: String::from_str(&s.env, "ambit:test"),
        signers: Vec::new(&s.env),
        signer_ids: Vec::new(&s.env),
        policies: Vec::new(&s.env),
        policy_ids: Vec::new(&s.env),
        valid_until: Some(s.env.ledger().sequence() + 17_280),
    }
}

fn usdc_rule(s: &Setup, id: u32) -> ContextRule {
    rule(s, id, ContextRuleType::CallContract(s.usdc.clone()))
}

fn payees(env: &Env, n: u32) -> Vec<Address> {
    let mut out = Vec::new(env);
    for _ in 0..n {
        out.push_back(Address::generate(env));
    }
    out
}

fn params(env: &Env, payees: Vec<Address>, max_per_payment: i128) -> AmbitParams {
    AmbitParams {
        mandate_hash: BytesN::from_array(env, &[7; 32]),
        max_per_payment,
        payees,
    }
}

fn transfer(s: &Setup, to: &Address, amount: i128) -> Context {
    let args: Vec<Val> = vec![
        &s.env,
        s.account.into_val(&s.env),
        to.into_val(&s.env),
        amount.into_val(&s.env),
    ];
    Context::Contract(ContractContext {
        contract: s.usdc.clone(),
        fn_name: Symbol::new(&s.env, "transfer"),
        args,
    })
}

/// The contract error a refused call returned. Policy functions panic with `AmbitError`, which
/// reaches the caller as a generic `Error` carrying the same code.
fn code(e: AmbitError) -> Error {
    e.into()
}

fn install_error(s: &Setup, p: &AmbitParams, r: &ContextRule) -> Error {
    s.policy.try_install(p, r, &s.account).unwrap_err().unwrap()
}

#[test]
fn install_stores_the_config() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, 2), 20_0000000);
    s.policy.install(&p, &usdc_rule(&s, 1), &s.account);

    assert_eq!(s.policy.get_config(&s.account, &1), Some(p));
    assert_eq!(s.policy.get_config(&s.account, &2), None);
}

#[test]
fn install_requires_the_account() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, 1), 1);
    s.policy.install(&p, &usdc_rule(&s, 1), &s.account);

    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.account);
}

#[test]
fn install_without_the_account_signature_fails() {
    let env = Env::default();
    let id = env.register(AmbitPolicy, ());
    let policy = AmbitPolicyClient::new(&env, &id);
    let s = Setup {
        account: Address::generate(&env),
        usdc: Address::generate(&env),
        env,
        policy,
    };
    let p = params(&s.env, payees(&s.env, 1), 1);
    assert!(s
        .policy
        .try_install(&p, &usdc_rule(&s, 1), &s.account)
        .is_err());
    assert_eq!(s.policy.get_config(&s.account, &1), None);
}

#[test]
fn install_emits_installed() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, 1), 1);
    s.policy.install(&p, &usdc_rule(&s, 3), &s.account);

    let expected = Installed {
        smart_account: s.account.clone(),
        rule_id: 3,
        mandate_hash: p.mandate_hash.clone(),
    };
    assert_eq!(
        s.env.events().all(),
        [expected.to_xdr(&s.env, &s.policy.address)]
    );
}

#[test]
fn uninstall_emits_uninstalled() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, 1), 1);
    s.policy.install(&p, &usdc_rule(&s, 3), &s.account);
    s.policy.uninstall(&usdc_rule(&s, 3), &s.account);

    let expected = Uninstalled {
        smart_account: s.account.clone(),
        rule_id: 3,
    };
    assert_eq!(
        s.env.events().all(),
        [expected.to_xdr(&s.env, &s.policy.address)]
    );
}

#[test]
fn install_twice_is_refused() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, 1), 1);
    s.policy.install(&p, &usdc_rule(&s, 1), &s.account);
    assert_eq!(
        install_error(&s, &p, &usdc_rule(&s, 1)),
        code(AmbitError::AlreadyInstalled)
    );
}

#[test]
fn rules_and_accounts_are_independent() {
    let s = setup();
    let other = Address::generate(&s.env);
    let a = params(&s.env, payees(&s.env, 1), 1);
    let b = params(&s.env, payees(&s.env, 2), 2);
    s.policy.install(&a, &usdc_rule(&s, 1), &s.account);
    s.policy.install(&b, &usdc_rule(&s, 2), &s.account);
    s.policy.install(&b, &usdc_rule(&s, 1), &other);

    assert_eq!(s.policy.get_config(&s.account, &1), Some(a));
    assert_eq!(s.policy.get_config(&s.account, &2), Some(b.clone()));
    assert_eq!(s.policy.get_config(&other, &1), Some(b));
}

#[test]
fn invalid_params_are_refused() {
    let s = setup();
    let r = usdc_rule(&s, 1);
    let dup = payees(&s.env, 1).get_unchecked(0);
    let cases = [
        params(&s.env, payees(&s.env, 0), 1),
        params(&s.env, payees(&s.env, MAX_PAYEES + 1), 1),
        params(&s.env, vec![&s.env, dup.clone(), dup], 1),
        params(&s.env, payees(&s.env, 1), 0),
        params(&s.env, payees(&s.env, 1), -1),
    ];
    for p in cases {
        assert_eq!(install_error(&s, &p, &r), code(AmbitError::InvalidParams));
    }
    assert_eq!(s.policy.get_config(&s.account, &1), None);
}

#[test]
fn twenty_payees_are_accepted() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, MAX_PAYEES), 1);
    s.policy.install(&p, &usdc_rule(&s, 1), &s.account);
    assert_eq!(
        s.policy.get_config(&s.account, &1).unwrap().payees.len(),
        MAX_PAYEES
    );
}

#[test]
fn only_call_contract_rules_are_accepted() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, 1), 1);
    let default_rule = rule(&s, 0, ContextRuleType::Default);
    assert_eq!(
        install_error(&s, &p, &default_rule),
        code(AmbitError::InvalidParams)
    );
}

#[test]
fn uninstall_removes_the_config() {
    let s = setup();
    let p = params(&s.env, payees(&s.env, 1), 1);
    s.policy.install(&p, &usdc_rule(&s, 1), &s.account);
    s.policy.uninstall(&usdc_rule(&s, 1), &s.account);

    assert_eq!(s.policy.get_config(&s.account, &1), None);
    let err = s
        .policy
        .try_uninstall(&usdc_rule(&s, 1), &s.account)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, code(AmbitError::NotInstalled));
}

#[test]
fn uninstall_then_enforce_is_refused() {
    let s = setup();
    let payee = Address::generate(&s.env);
    let p = params(&s.env, vec![&s.env, payee.clone()], 10);
    s.policy.install(&p, &usdc_rule(&s, 1), &s.account);
    s.policy.uninstall(&usdc_rule(&s, 1), &s.account);

    let signers = Vec::new(&s.env);
    let err = s
        .policy
        .try_enforce(
            &transfer(&s, &payee, 1),
            &signers,
            &usdc_rule(&s, 1),
            &s.account,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, code(AmbitError::NotInstalled));
}

// ---- enforce and check_payment ----

/// Cap per payment used by the enforce tests: 10 USDC.
const CAP: i128 = 10_0000000;

/// Installs a mandate on rule 1 that allows `CAP` per payment to one payee, and returns it.
fn install_mandate(s: &Setup) -> Address {
    let payee = Address::generate(&s.env);
    let p = params(&s.env, vec![&s.env, payee.clone()], CAP);
    s.policy.install(&p, &usdc_rule(s, 1), &s.account);
    payee
}

/// A contract call context with any target, function and arguments.
fn call(s: &Setup, contract: &Address, fn_name: &str, args: Vec<Val>) -> Context {
    Context::Contract(ContractContext {
        contract: contract.clone(),
        fn_name: Symbol::new(&s.env, fn_name),
        args,
    })
}

/// `transfer(from, to, amount)` on USDC with an explicit `from`.
fn transfer_from_address(s: &Setup, from: &Address, to: &Address, amount: i128) -> Context {
    let args = vec![
        &s.env,
        from.into_val(&s.env),
        to.into_val(&s.env),
        amount.into_val(&s.env),
    ];
    call(s, &s.usdc, "transfer", args)
}

/// Runs `enforce` on rule 1 and returns the refusal, if any.
fn enforce(s: &Setup, context: &Context) -> Result<(), Error> {
    let signers = Vec::new(&s.env);
    match s
        .policy
        .try_enforce(context, &signers, &usdc_rule(s, 1), &s.account)
    {
        Ok(_) => Ok(()),
        Err(e) => Err(e.unwrap()),
    }
}

fn refused(s: &Setup, context: &Context) -> Error {
    enforce(s, context).unwrap_err()
}

#[test]
fn a_payment_inside_the_mandate_passes() {
    let s = setup();
    let payee = install_mandate(&s);
    assert_eq!(enforce(&s, &transfer(&s, &payee, 1)), Ok(()));
    assert_eq!(enforce(&s, &transfer(&s, &payee, CAP)), Ok(()));
}

#[test]
fn enforce_without_install_is_refused() {
    let s = setup();
    let payee = Address::generate(&s.env);
    assert_eq!(
        refused(&s, &transfer(&s, &payee, 1)),
        code(AmbitError::NotInstalled)
    );
}

// Check 1: the call is to the rule's asset contract.

#[test]
fn a_call_to_another_contract_is_refused() {
    let s = setup();
    let payee = install_mandate(&s);
    let other = Address::generate(&s.env);
    let args = vec![
        &s.env,
        s.account.into_val(&s.env),
        payee.into_val(&s.env),
        1_i128.into_val(&s.env),
    ];
    assert_eq!(
        refused(&s, &call(&s, &other, "transfer", args)),
        code(AmbitError::WrongContext)
    );
}

#[test]
fn a_contract_deployment_is_refused() {
    let s = setup();
    install_mandate(&s);
    let deploy = Context::CreateContractHostFn(CreateContractHostFnContext {
        executable: ContractExecutable::Wasm(BytesN::from_array(&s.env, &[1; 32])),
        salt: BytesN::from_array(&s.env, &[2; 32]),
    });
    assert_eq!(refused(&s, &deploy), code(AmbitError::WrongContext));
}

// Check 2: the function is `transfer`.

#[test]
fn functions_other_than_transfer_are_refused() {
    let s = setup();
    let payee = install_mandate(&s);
    // approve(from, spender, amount, expiration_ledger)
    let approve = vec![
        &s.env,
        s.account.into_val(&s.env),
        payee.into_val(&s.env),
        CAP.into_val(&s.env),
        1000_u32.into_val(&s.env),
    ];
    // transfer_from(spender, from, to, amount)
    let transfer_from = vec![
        &s.env,
        s.account.into_val(&s.env),
        s.account.into_val(&s.env),
        payee.into_val(&s.env),
        1_i128.into_val(&s.env),
    ];
    // burn(from, amount)
    let burn = vec![&s.env, s.account.into_val(&s.env), 1_i128.into_val(&s.env)];
    for (name, args) in [
        ("approve", approve),
        ("transfer_from", transfer_from),
        ("burn", burn),
    ] {
        assert_eq!(
            refused(&s, &call(&s, &s.usdc, name, args)),
            code(AmbitError::FunctionNotAllowed),
            "{name}"
        );
    }
}

#[test]
fn transfer_with_the_wrong_arguments_is_refused() {
    let s = setup();
    let payee = install_mandate(&s);
    let e = &s.env;
    let cases: [Vec<Val>; 4] = [
        // Too few.
        vec![e, s.account.into_val(e), payee.into_val(e)],
        // Too many.
        vec![
            e,
            s.account.into_val(e),
            payee.into_val(e),
            1_i128.into_val(e),
            1_i128.into_val(e),
        ],
        // `to` is not an address.
        vec![
            e,
            s.account.into_val(e),
            Symbol::new(e, "payee").into_val(e),
            1_i128.into_val(e),
        ],
        // `amount` is not an i128.
        vec![
            e,
            s.account.into_val(e),
            payee.into_val(e),
            1_u32.into_val(e),
        ],
    ];
    for args in cases {
        assert_eq!(
            refused(&s, &call(&s, &s.usdc, "transfer", args)),
            code(AmbitError::BadArgs)
        );
    }
}

// Check 3: `from` is the smart account.

#[test]
fn a_transfer_from_another_address_is_refused() {
    let s = setup();
    let payee = install_mandate(&s);
    let someone = Address::generate(&s.env);
    assert_eq!(
        refused(&s, &transfer_from_address(&s, &someone, &payee, 1)),
        code(AmbitError::FromNotAccount)
    );
}

// Check 4: `to` is an allowed payee.

#[test]
fn a_payee_outside_the_list_is_refused() {
    let s = setup();
    install_mandate(&s);
    let stranger = Address::generate(&s.env);
    assert_eq!(
        refused(&s, &transfer(&s, &stranger, 1)),
        code(AmbitError::PayeeNotAllowed)
    );
}

#[test]
fn paying_the_account_itself_is_refused() {
    let s = setup();
    install_mandate(&s);
    assert_eq!(
        refused(&s, &transfer(&s, &s.account.clone(), 1)),
        code(AmbitError::PayeeNotAllowed)
    );
}

// Check 5: `0 < amount <= max_per_payment`.

#[test]
fn a_zero_or_negative_amount_is_refused() {
    let s = setup();
    let payee = install_mandate(&s);
    for amount in [0, -1, i128::MIN] {
        assert_eq!(
            refused(&s, &transfer(&s, &payee, amount)),
            code(AmbitError::AmountNotPositive)
        );
    }
}

#[test]
fn an_amount_above_the_cap_is_refused() {
    let s = setup();
    let payee = install_mandate(&s);
    for amount in [CAP + 1, i128::MAX] {
        assert_eq!(
            refused(&s, &transfer(&s, &payee, amount)),
            code(AmbitError::AmountAboveCap)
        );
    }
}

#[test]
fn a_refusal_reaches_the_client_as_the_contract_error_code() {
    let s = setup();
    install_mandate(&s);
    let stranger = Address::generate(&s.env);
    // What a client sees in the simulation result: `Error(Contract, #9006)`.
    assert_eq!(
        refused(&s, &transfer(&s, &stranger, 1)),
        Error::from_contract_error(9006)
    );
}

#[test]
fn enforce_requires_the_account() {
    let s = setup();
    let payee = install_mandate(&s);
    enforce(&s, &transfer(&s, &payee, 1)).unwrap();
    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.account);
}

#[test]
fn enforce_emits_no_events() {
    let s = setup();
    let payee = install_mandate(&s);
    enforce(&s, &transfer(&s, &payee, 1)).unwrap();
    assert_eq!(s.env.events().all().events().len(), 0);
}

#[test]
fn enforce_extends_the_config_only_when_close_to_expiry() {
    let s = setup();
    let payee = Address::generate(&s.env);
    let mut open_rule = usdc_rule(&s, 1);
    open_rule.valid_until = None;
    let p = params(&s.env, vec![&s.env, payee.clone()], CAP);
    s.policy.install(&p, &open_rule, &s.account);
    let ttl = || {
        s.env
            .as_contract(&s.policy.address, || storage::ttl(&s.env, &s.account, 1))
    };
    let signers = Vec::new(&s.env);
    let pay = || {
        s.policy
            .enforce(&transfer(&s, &payee, 1), &signers, &open_rule, &s.account)
    };
    let max = ttl();

    // Plenty of lifetime left: no extension.
    s.env.ledger().with_mut(|l| l.sequence_number += 1_000);
    pay();
    assert_eq!(ttl(), max - 1_000);

    // One day left: extended back to the network max.
    s.env
        .ledger()
        .with_mut(|l| l.sequence_number += max - 1_000 - 17_280);
    assert_eq!(ttl(), 17_280);
    pay();
    assert_eq!(ttl(), max);
}

#[test]
fn check_payment_returns_the_enforce_code() {
    let s = setup();
    let payee = install_mandate(&s);
    let stranger = Address::generate(&s.env);
    let other_account = Address::generate(&s.env);
    let check = |account: &Address, to: &Address, amount: i128| {
        s.policy.check_payment(account, &1, to, &amount)
    };

    assert_eq!(check(&s.account, &payee, CAP), 0);
    assert_eq!(check(&other_account, &payee, 1), 9001);
    assert_eq!(check(&s.account, &stranger, 1), 9006);
    assert_eq!(check(&s.account, &payee, 0), 9007);
    assert_eq!(check(&s.account, &payee, CAP + 1), 9008);
}

#[test]
fn check_payment_agrees_with_enforce() {
    let s = setup();
    let payee = install_mandate(&s);
    let stranger = Address::generate(&s.env);
    for to in [&payee, &stranger] {
        for amount in [i128::MIN, -1, 0, 1, CAP - 1, CAP, CAP + 1, i128::MAX] {
            let expected = match enforce(&s, &transfer(&s, to, amount)) {
                Ok(()) => 0,
                Err(e) => e.get_code(),
            };
            assert_eq!(
                s.policy.check_payment(&s.account, &1, to, &amount),
                expected,
                "to={to:?} amount={amount}"
            );
        }
    }
}
