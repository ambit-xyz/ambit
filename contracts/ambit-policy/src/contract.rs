use soroban_sdk::{auth::Context, contract, contractimpl, panic_with_error, Address, Env, Vec};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, Signer},
};

use crate::{
    check,
    error::AmbitError,
    events::{Installed, Uninstalled},
    storage::{self, AmbitParams},
};

#[contract]
pub struct AmbitPolicy;

/// The OpenZeppelin `Policy` interface. The smart account calls these, never a user directly.
#[contractimpl]
impl Policy for AmbitPolicy {
    type AccountParams = AmbitParams;

    /// Called by the smart account inside `__check_auth` for every authorization on the rule.
    /// A panic refuses the authorization. Must never emit an event.
    fn enforce(
        e: &Env,
        context: Context,
        _authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        let Some(config) = storage::get(e, &smart_account, context_rule.id) else {
            panic_with_error!(e, AmbitError::NotInstalled)
        };
        if let Err(err) = check::check(e, &context, &config, &context_rule, &smart_account) {
            panic_with_error!(e, err)
        }
        storage::extend(e, &smart_account, &context_rule);
    }

    /// Called by the smart account when the owner adds this policy to a rule.
    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        storage::validate(e, &install_params, &context_rule);
        if storage::has(e, &smart_account, context_rule.id) {
            panic_with_error!(e, AmbitError::AlreadyInstalled);
        }
        storage::set(e, &smart_account, &context_rule, &install_params);
        Installed {
            smart_account,
            rule_id: context_rule.id,
            mandate_hash: install_params.mandate_hash,
        }
        .publish(e);
    }

    /// Called by the smart account when the owner removes this policy or its rule.
    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        if !storage::has(e, &smart_account, context_rule.id) {
            panic_with_error!(e, AmbitError::NotInstalled)
        }
        storage::remove(e, &smart_account, context_rule.id);
        Uninstalled {
            smart_account,
            rule_id: context_rule.id,
        }
        .publish(e);
    }
}

#[contractimpl]
impl AmbitPolicy {
    /// The config enforced for a rule, or `None` if not installed. Read-only.
    pub fn get_config(e: Env, smart_account: Address, rule_id: u32) -> Option<AmbitParams> {
        storage::get(&e, &smart_account, rule_id)
    }

    /// Would a `transfer` of `amount` to `to` pass checks 4 and 5 on this rule? Returns 0 if
    /// yes, otherwise the `AmbitError` code `enforce` would panic with. Read-only, needs no
    /// signature. Checks 1 to 3 are about the call itself, which the caller builds, so they are
    /// not repeated here.
    pub fn check_payment(
        e: Env,
        smart_account: Address,
        rule_id: u32,
        to: Address,
        amount: i128,
    ) -> u32 {
        let Some(config) = storage::get(&e, &smart_account, rule_id) else {
            return AmbitError::NotInstalled as u32;
        };
        match check::check_payee_and_amount(&config, &to, amount) {
            Ok(()) => 0,
            Err(err) => err as u32,
        }
    }
}
