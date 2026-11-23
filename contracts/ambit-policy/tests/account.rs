//! `ambit-policy` inside a real OpenZeppelin smart account, with real signatures.
//!
//! Each refusal is checked twice: the payment itself fails and moves no money, and the
//! account's `__check_auth` names the reason with a contract error code.

mod common;

extern crate std;

use common::*;
use soroban_sdk::{
    testutils::Address as _, token::TokenClient, vec, Address, IntoVal, Symbol, Val,
};

// Error codes the account and the stock spending-limit policy return.
const CONTEXT_RULE_NOT_FOUND: u32 = 3000;
const UNVALIDATED_CONTEXT: u32 = 3002;
const UNAUTHORIZED_SIGNER: u32 = 3016;
const SPENDING_LIMIT_EXCEEDED: u32 = 3221;

// Ambit codes.
const FUNCTION_NOT_ALLOWED: u32 = 9003;
const FROM_NOT_ACCOUNT: u32 = 9005;
const PAYEE_NOT_ALLOWED: u32 = 9006;
const AMOUNT_NOT_POSITIVE: u32 = 9007;
const AMOUNT_ABOVE_CAP: u32 = 9008;
const NO_SIGNER: u32 = 9011;

/// Asserts that a refused call moved no USDC and recorded nothing in the spending limit.
fn assert_nothing_moved(w: &World, spent_before: i128) {
    assert_eq!(w.balance(&w.usdc, &w.account), START_BALANCE - spent_before);
    assert_eq!(w.spent(), spent_before);
}

#[test]
fn a_payment_inside_the_mandate_settles() {
    let w = World::new();
    assert!(w.pay(&w.payee, CAP));
    assert_eq!(w.balance(&w.usdc, &w.payee), CAP);
    assert_eq!(w.balance(&w.usdc, &w.account), START_BALANCE - CAP);
    assert_eq!(w.spent(), CAP);
}

#[test]
fn install_through_the_account_stores_the_config() {
    let w = World::new();
    let config = w.policy().get_config(&w.account, &w.rule_id).unwrap();
    assert_eq!(config.max_per_payment, CAP);
    assert_eq!(config.payees, vec![&w.env, w.payee.clone()]);
}

#[test]
fn a_payment_without_a_signature_is_refused() {
    let w = World::new();
    w.env.set_auths(&[]);
    let result = w.env.try_invoke_contract::<Val, soroban_sdk::Error>(
        &w.usdc,
        &Symbol::new(&w.env, "transfer"),
        w.transfer_args(&w.payee, 1),
    );
    assert!(result.is_err());
    assert_nothing_moved(&w, 0);
}

#[test]
fn a_payment_signed_by_an_unknown_key_is_refused() {
    let w = World::new();
    let args = w.transfer_args(&w.payee, 1);
    assert!(!w.call_token(&w.stranger, &w.usdc, "transfer", args.clone()));
    assert_eq!(
        w.refusal(&w.stranger, &w.usdc, "transfer", args),
        Some(UNAUTHORIZED_SIGNER)
    );
    assert_nothing_moved(&w, 0);
}

// No signer. On a rule with policies, the account does not require any of the rule's signers to
// have signed: it hands the policies the signers that did, which can be none. An auth entry that
// selects the mandate rule with an empty signer map needs no key, so anyone can build one. The
// stock spending limit refuses it, but `ambit-policy` must refuse it too: between the two
// transactions that create a mandate, and after the owner removes the spending limit,
// `ambit-policy` is the only policy on the rule.

#[test]
fn a_payment_without_any_key_is_refused_before_the_spending_limit_is_added() {
    let w = World::without_limit();
    let rule = w.account().get_context_rule(&w.rule_id);
    assert_eq!(rule.policies, vec![&w.env, w.policy.clone()]);

    for _ in 0..3 {
        assert!(!w.pay_without_key(&w.payee, CAP));
    }
    assert_eq!(
        w.refusal_with(
            None,
            w.rule_id,
            &w.usdc,
            "transfer",
            w.transfer_args(&w.payee, CAP)
        ),
        Some(NO_SIGNER)
    );
    assert_eq!(w.balance(&w.usdc, &w.payee), 0);
    assert_eq!(w.balance(&w.usdc, &w.account), START_BALANCE);

    // The agent can still pay inside the mandate.
    assert!(w.pay(&w.payee, CAP));
}

#[test]
fn a_payment_without_any_key_is_refused_by_ambit_policy_first() {
    let w = World::new();
    assert!(!w.pay_without_key(&w.payee, 1));
    assert_eq!(
        w.refusal_with(
            None,
            w.rule_id,
            &w.usdc,
            "transfer",
            w.transfer_args(&w.payee, 1)
        ),
        Some(NO_SIGNER)
    );
    assert_nothing_moved(&w, 0);
}

#[test]
fn a_payment_without_any_key_is_refused_after_the_spending_limit_is_removed() {
    let w = World::new();
    w.remove_limit();
    let rule = w.account().get_context_rule(&w.rule_id);
    assert_eq!(rule.policies, vec![&w.env, w.policy.clone()]);

    assert!(!w.pay_without_key(&w.payee, CAP));
    assert_eq!(
        w.refusal_with(
            None,
            w.rule_id,
            &w.usdc,
            "transfer",
            w.transfer_args(&w.payee, CAP)
        ),
        Some(NO_SIGNER)
    );
    assert_eq!(w.balance(&w.usdc, &w.payee), 0);
    assert!(w.pay(&w.payee, CAP));
}

// Check 1: the call is to the rule's asset. The account refuses a call to another contract
// before any policy runs, because the mandate rule only matches USDC. The policy's own check is
// a second line, covered by the unit tests.

#[test]
fn another_asset_is_refused() {
    let w = World::new();
    let args = w.transfer_args(&w.payee, 1);
    assert!(!w.call_token(&w.agent, &w.other_token, "transfer", args.clone()));
    assert_eq!(
        w.refusal(&w.agent, &w.other_token, "transfer", args),
        Some(UNVALIDATED_CONTEXT)
    );
    assert_eq!(w.balance(&w.other_token, &w.account), START_BALANCE);
}

// Check 2: only `transfer`.

#[test]
fn approve_is_refused() {
    let w = World::new();
    let e = &w.env;
    let expiration = e.ledger().sequence() + 1_000;
    let args: soroban_sdk::Vec<Val> = vec![
        e,
        w.account.into_val(e),
        w.payee.into_val(e),
        CAP.into_val(e),
        expiration.into_val(e),
    ];
    assert!(!w.call_token(&w.agent, &w.usdc, "approve", args.clone()));
    assert_eq!(
        w.refusal(&w.agent, &w.usdc, "approve", args),
        Some(FUNCTION_NOT_ALLOWED)
    );
    assert_eq!(
        TokenClient::new(e, &w.usdc).allowance(&w.account, &w.payee),
        0
    );
}

#[test]
fn transfer_from_is_refused() {
    let w = World::new();
    let e = &w.env;
    // transfer_from(spender, from, to, amount): the account as spender asks for its own auth.
    let args: soroban_sdk::Vec<Val> = vec![
        e,
        w.account.into_val(e),
        w.account.into_val(e),
        w.payee.into_val(e),
        1_i128.into_val(e),
    ];
    assert!(!w.call_token(&w.agent, &w.usdc, "transfer_from", args.clone()));
    assert_eq!(
        w.refusal(&w.agent, &w.usdc, "transfer_from", args),
        Some(FUNCTION_NOT_ALLOWED)
    );
    assert_nothing_moved(&w, 0);
}

#[test]
fn burn_is_refused() {
    let w = World::new();
    let e = &w.env;
    let args: soroban_sdk::Vec<Val> = vec![e, w.account.into_val(e), 1_i128.into_val(e)];
    assert!(!w.call_token(&w.agent, &w.usdc, "burn", args.clone()));
    assert_eq!(
        w.refusal(&w.agent, &w.usdc, "burn", args),
        Some(FUNCTION_NOT_ALLOWED)
    );
    assert_nothing_moved(&w, 0);
}

// Check 3: `from` is the account. A `transfer` from another address never asks this account
// for authorization, so the host cannot produce this context in a payment. The test hands it
// to `__check_auth` directly to show the policy refuses it anyway.

#[test]
fn a_transfer_from_another_address_is_refused() {
    let w = World::new();
    let e = &w.env;
    let someone = Address::generate(e);
    let args: soroban_sdk::Vec<Val> = vec![
        e,
        someone.into_val(e),
        w.payee.into_val(e),
        1_i128.into_val(e),
    ];
    assert_eq!(
        w.refusal(&w.agent, &w.usdc, "transfer", args),
        Some(FROM_NOT_ACCOUNT)
    );
}

// Check 4: allowed payees only. Also the policy order: `ambit-policy` runs first, so a wrong
// payee is refused with the Ambit code even when the amount would also break the period cap,
// and the spending limit records nothing.

#[test]
fn a_payee_outside_the_list_is_refused_before_the_spending_limit() {
    let w = World::new();
    let rule = w.account().get_context_rule(&w.rule_id);
    assert_eq!(
        rule.policies,
        vec![&w.env, w.policy.clone(), w.spending_limit.clone()]
    );

    let stranger = Address::generate(&w.env);
    for amount in [1, PERIOD_CAP + 1] {
        assert!(!w.pay(&stranger, amount));
        assert_eq!(
            w.refusal(
                &w.agent,
                &w.usdc,
                "transfer",
                w.transfer_args(&stranger, amount)
            ),
            Some(PAYEE_NOT_ALLOWED)
        );
    }
    assert_eq!(w.balance(&w.usdc, &stranger), 0);
    assert_nothing_moved(&w, 0);
}

// Check 5: `0 < amount <= cap per payment`.

#[test]
fn an_amount_outside_the_cap_is_refused() {
    let w = World::new();
    for (amount, code) in [
        (0, AMOUNT_NOT_POSITIVE),
        (-1, AMOUNT_NOT_POSITIVE),
        (CAP + 1, AMOUNT_ABOVE_CAP),
    ] {
        assert!(!w.pay(&w.payee, amount), "{amount}");
        assert_eq!(
            w.refusal(
                &w.agent,
                &w.usdc,
                "transfer",
                w.transfer_args(&w.payee, amount)
            ),
            Some(code),
            "{amount}"
        );
    }
    assert_nothing_moved(&w, 0);
    assert!(w.pay(&w.payee, CAP));
}

// The two policies together: the spending limit caps the period, and resets after it.

#[test]
fn the_period_cap_stops_payments_and_resets() {
    let w = World::new();
    assert!(w.pay(&w.payee, CAP));
    assert!(w.pay(&w.payee, CAP));
    assert!(w.pay(&w.payee, PERIOD_CAP - 2 * CAP));
    assert_eq!(w.spent(), PERIOD_CAP);

    assert!(!w.pay(&w.payee, 1));
    assert_eq!(
        w.refusal(&w.agent, &w.usdc, "transfer", w.transfer_args(&w.payee, 1)),
        Some(SPENDING_LIMIT_EXCEEDED)
    );
    assert_eq!(w.balance(&w.usdc, &w.payee), PERIOD_CAP);

    w.advance(PERIOD + 1);
    assert!(w.pay(&w.payee, CAP));
    assert_eq!(w.balance(&w.usdc, &w.payee), PERIOD_CAP + CAP);
}

#[test]
fn an_expired_mandate_is_refused() {
    let w = World::new();
    assert!(w.pay(&w.payee, 1));
    w.advance(DAY + 1);
    assert!(!w.pay(&w.payee, 1));
    // The account no longer matches the rule once `valid_until` has passed.
    assert_eq!(
        w.refusal(&w.agent, &w.usdc, "transfer", w.transfer_args(&w.payee, 1)),
        Some(UNVALIDATED_CONTEXT)
    );
    assert_eq!(w.balance(&w.usdc, &w.payee), 1);
}

#[test]
fn a_revoked_mandate_is_refused_and_its_config_removed() {
    let w = World::new();
    assert!(w.pay(&w.payee, 1));

    let args: soroban_sdk::Vec<Val> = vec![&w.env, w.rule_id.into_val(&w.env)];
    w.sign_as(
        &w.owner,
        OWNER_RULE,
        &w.account,
        "remove_context_rule",
        &args,
    );
    w.account().remove_context_rule(&w.rule_id);

    assert_eq!(w.policy().get_config(&w.account, &w.rule_id), None);
    assert!(!w.pay(&w.payee, 1));
    assert_eq!(
        w.refusal(&w.agent, &w.usdc, "transfer", w.transfer_args(&w.payee, 1)),
        Some(CONTEXT_RULE_NOT_FOUND)
    );
    assert_eq!(w.balance(&w.usdc, &w.payee), 1);
}

#[test]
fn the_agent_cannot_change_rules() {
    let w = World::new();
    let e = &w.env;
    let later: Option<u32> = Some(e.ledger().sequence() + 100 * DAY);
    let widen: soroban_sdk::Vec<Val> = vec![e, w.rule_id.into_val(e), later.into_val(e)];
    let remove: soroban_sdk::Vec<Val> = vec![e, w.rule_id.into_val(e)];

    for (name, args) in [
        ("update_context_rule_valid_until", widen),
        ("remove_context_rule", remove),
    ] {
        // Under the mandate rule: the call is not to USDC, so the rule does not apply.
        assert_eq!(
            w.refusal_on(&w.agent, w.rule_id, &w.account, name, args.clone()),
            Some(UNVALIDATED_CONTEXT),
            "{name}"
        );
        // Under the owner rule: the agent is not one of its signers, so the rule is not met.
        assert_eq!(
            w.refusal_on(&w.agent, OWNER_RULE, &w.account, name, args),
            Some(UNVALIDATED_CONTEXT),
            "{name}"
        );
    }
    assert!(w.policy().get_config(&w.account, &w.rule_id).is_some());
}
