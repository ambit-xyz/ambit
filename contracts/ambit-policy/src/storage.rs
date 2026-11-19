use soroban_sdk::{contracttype, panic_with_error, Address, BytesN, Env, Vec};
use stellar_accounts::smart_account::{ContextRule, ContextRuleType};

use crate::error::AmbitError;

/// Most payees one mandate can list.
pub const MAX_PAYEES: u32 = 20;

/// About one day of ledgers at 5 s each.
const DAY_IN_LEDGERS: u32 = 17_280;

/// Extra lifetime kept after a rule's `valid_until`, so the config outlives the rule.
const TTL_MARGIN: u32 = 7 * DAY_IN_LEDGERS;

/// `enforce` extends the config once less than this lifetime is left.
const TTL_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;

/// What the owner installs on a mandate rule. Also what `get_config` returns.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AmbitParams {
    /// SHA-256 of the canonical mandate JSON this rule was compiled from.
    pub mandate_hash: BytesN<32>,
    /// Cap per payment, in stroops (1 USDC = 10^7).
    pub max_per_payment: i128,
    /// Addresses the agent may pay. 1 to 20, no duplicates.
    pub payees: Vec<Address>,
}

#[contracttype]
enum DataKey {
    Config(Address, u32),
}

fn key(smart_account: &Address, rule_id: u32) -> DataKey {
    DataKey::Config(smart_account.clone(), rule_id)
}

pub fn get(e: &Env, smart_account: &Address, rule_id: u32) -> Option<AmbitParams> {
    e.storage().persistent().get(&key(smart_account, rule_id))
}

pub fn has(e: &Env, smart_account: &Address, rule_id: u32) -> bool {
    e.storage().persistent().has(&key(smart_account, rule_id))
}

pub fn set(e: &Env, smart_account: &Address, rule: &ContextRule, params: &AmbitParams) {
    let k = key(smart_account, rule.id);
    e.storage().persistent().set(&k, params);
    let extend_to = lifetime_for(e, rule);
    e.storage()
        .persistent()
        .extend_ttl(&k, extend_to, extend_to);
}

/// Called from `enforce`. Extends the config only when it is close to expiry, so most payments
/// do not pay for a TTL write.
pub fn extend(e: &Env, smart_account: &Address, rule: &ContextRule) {
    let extend_to = lifetime_for(e, rule);
    e.storage().persistent().extend_ttl(
        &key(smart_account, rule.id),
        TTL_THRESHOLD.min(extend_to),
        extend_to,
    );
}

/// Ledgers left before the config is archived. Tests only.
#[cfg(test)]
pub fn ttl(e: &Env, smart_account: &Address, rule_id: u32) -> u32 {
    use soroban_sdk::testutils::storage::Persistent as _;
    e.storage()
        .persistent()
        .get_ttl(&key(smart_account, rule_id))
}

pub fn remove(e: &Env, smart_account: &Address, rule_id: u32) {
    e.storage()
        .persistent()
        .remove(&key(smart_account, rule_id));
}

/// Ledgers of lifetime to keep: until `valid_until` plus a margin, capped by the network max.
/// A rule without an end gets the network max.
fn lifetime_for(e: &Env, rule: &ContextRule) -> u32 {
    let max = e.storage().max_ttl();
    match rule.valid_until {
        Some(until) => until
            .saturating_sub(e.ledger().sequence())
            .saturating_add(TTL_MARGIN)
            .min(max),
        None => max,
    }
}

/// Refuses parameters the policy could never enforce safely.
pub fn validate(e: &Env, params: &AmbitParams, rule: &ContextRule) {
    if !matches!(rule.context_type, ContextRuleType::CallContract(_)) {
        panic_with_error!(e, AmbitError::InvalidParams)
    }
    if params.max_per_payment <= 0 {
        panic_with_error!(e, AmbitError::InvalidParams)
    }
    let count = params.payees.len();
    if count == 0 || count > MAX_PAYEES {
        panic_with_error!(e, AmbitError::InvalidParams)
    }
    for i in 0..count {
        for j in (i + 1)..count {
            if params.payees.get_unchecked(i) == params.payees.get_unchecked(j) {
                panic_with_error!(e, AmbitError::InvalidParams)
            }
        }
    }
}
