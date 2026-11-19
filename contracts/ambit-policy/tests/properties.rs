//! Property test: `check_payment` and `enforce` never disagree.
//!
//! Each case builds a fresh account with a random mandate, then the agent signs one random call
//! on USDC. `enforce` runs for real inside the account's `__check_auth`. The call passes exactly
//! when it is a `transfer` and `check_payment` returns 0, and a refused `transfer` carries the
//! code `check_payment` returned.
//!
//! The two share one function in the contract, so agreeing alone would not catch a bug in it.
//! Each case is also compared with the mandate rules written out again here.

mod common;

extern crate std;

use common::*;
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, vec, Address, IntoVal, Val, Vec};

const FUNCTIONS: [&str; 4] = ["transfer", "approve", "transfer_from", "burn"];

/// Arguments for each token function, with the account as the party that must authorize.
fn args_for(w: &World, fn_name: &str, to: &Address, amount: i128) -> Vec<Val> {
    let e = &w.env;
    match fn_name {
        "transfer" => w.transfer_args(to, amount),
        "approve" => vec![
            e,
            w.account.into_val(e),
            to.into_val(e),
            amount.into_val(e),
            (e.ledger().sequence() + 1_000).into_val(e),
        ],
        "transfer_from" => vec![
            e,
            w.account.into_val(e),
            w.account.into_val(e),
            to.into_val(e),
            amount.into_val(e),
        ],
        "burn" => vec![e, w.account.into_val(e), amount.into_val(e)],
        _ => unreachable!(),
    }
}

/// Half the cases hit an edge around the cap or of `i128`, the rest are anywhere in range.
fn amount(cap: i128, edge: u8, anywhere: i128) -> i128 {
    match edge {
        0 => cap - 1,
        1 => cap,
        2 => cap + 1,
        3 => 0,
        4 => -1,
        5 => i128::MIN,
        6 => i128::MAX,
        _ => anywhere,
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn check_payment_agrees_with_enforce(
        payee_count in 1usize..=5,
        cap in 1..=100 * USDC,
        pick in 0usize..=5,
        edge in 0u8..14,
        anywhere in -USDC..=200 * USDC,
        fn_index in 0usize..FUNCTIONS.len(),
    ) {
        let amount = amount(cap, edge, anywhere);
        let mut w = World::empty();
        let payees: std::vec::Vec<Address> =
            (0..payee_count).map(|_| Address::generate(&w.env)).collect();
        // The period cap is far above any allowed payment, so only `ambit-policy` decides.
        w.install(&Mandate {
            payees: payees.clone(),
            max_per_payment: cap,
            period_cap: 1_000_000 * USDC,
            valid_until: Some(w.env.ledger().sequence() + DAY),
        });
        // `pick` past the list is someone not allowed.
        let to = payees.get(pick).cloned().unwrap_or_else(|| Address::generate(&w.env));
        let fn_name = FUNCTIONS[fn_index];

        let expected = w.policy().check_payment(&w.account, &w.rule_id, &to, &amount);
        let refusal = w.refusal(&w.agent, &w.usdc, fn_name, args_for(&w, fn_name, &to, amount));

        if fn_name == "transfer" {
            let expected = if expected == 0 { None } else { Some(expected) };
            prop_assert_eq!(refusal, expected);
        } else {
            prop_assert_eq!(refusal, Some(9003));
        }

        let rules = if fn_name != "transfer" {
            Some(9003)
        } else if !payees.contains(&to) {
            Some(9006)
        } else if amount <= 0 {
            Some(9007)
        } else if amount > cap {
            Some(9008)
        } else {
            None
        };
        prop_assert_eq!(refusal, rules);
    }
}
