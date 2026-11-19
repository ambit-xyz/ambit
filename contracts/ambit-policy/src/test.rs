extern crate std;

use soroban_sdk::{
    auth::{Context, ContractContext},
    testutils::{Address as _, Events as _},
    vec, Address, BytesN, Env, Error, Event, IntoVal, String, Symbol, Val, Vec,
};
use stellar_accounts::smart_account::{ContextRule, ContextRuleType};

use crate::{
    events::{Installed, Uninstalled},
    AmbitError, AmbitParams, AmbitPolicy, AmbitPolicyClient, MAX_PAYEES,
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

#[test]
fn enforce_fails_closed_until_checks_exist() {
    let s = setup();
    let payee = Address::generate(&s.env);
    let p = params(&s.env, vec![&s.env, payee.clone()], 10);
    s.policy.install(&p, &usdc_rule(&s, 1), &s.account);

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
    assert_eq!(err, code(AmbitError::FunctionNotAllowed));
}
