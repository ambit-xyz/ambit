use soroban_sdk::{auth::Context, contract, contractimpl, panic_with_error, Address, Env, Vec};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, Signer},
};

use crate::{
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
    /// A panic refuse the authorization. Must never emit an event
    fn enforce(
        e: &Env,
        _context: Context,
        _authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        if storage::get(e, &smart_account, context_rule.id).is_none() {
            panic_with_error!(e, AmbitError::NotInstalled);
        }

        // The payment checks are not implemented yet, so every call is refused. Failing
        // closed means a deployment of this version can never let a payment through.
        panic_with_error!(e, AmbitError::FunctionNotAllowed);
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
}
