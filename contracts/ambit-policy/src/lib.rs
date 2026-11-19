#![no_std]
//! `ambit-policy`: payee allow-list and cap per payment for OpenZeppelin smart accounts,
//! `transfer` only.
//!
//! One deployed instance serves every smart account. Each account installs it on a mandate
//! rule, and the config is stored per `(smart_account, rule_id)`. The contract has no admin and
//! no upgrade function: once deployed, nobody can change how it decides.
//!
//! It does not track period totals (the OpenZeppelin spending-limit policy does), check
//! signatures (verifier contracts do) or check expiry (`valid_until` on the rule does).

mod check;
mod contract;
mod error;
mod events;
mod storage;

pub use contract::{AmbitPolicy, AmbitPolicyClient};
pub use error::AmbitError;
pub use storage::{AmbitParams, MAX_PAYEES};

#[cfg(test)]
mod test;
