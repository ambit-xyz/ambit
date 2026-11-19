use soroban_sdk::{auth::Context, symbol_short, Address, Env, TryFromVal, Val, Vec};
use stellar_accounts::smart_account::{ContextRule, ContextRuleType};

use crate::{error::AmbitError, storage::AmbitParams};

/// The five mandate checks, in order. The first failure is returned.
///
/// 1. the call is to the rule's asset contract,
/// 2. the function is `transfer`,
/// 3. `from` is the smart account,
/// 4. `to` is an allowed payee,
/// 5. `0 < amount <= max_per_payment`.
pub fn check(
    e: &Env,
    context: &Context,
    config: &AmbitParams,
    rule: &ContextRule,
    smart_account: &Address,
) -> Result<(), AmbitError> {
    let Context::Contract(call) = context else {
        return Err(AmbitError::WrongContext);
    };
    let ContextRuleType::CallContract(asset) = &rule.context_type else {
        return Err(AmbitError::WrongContext);
    };
    if call.contract != *asset {
        return Err(AmbitError::WrongContext);
    }
    if call.fn_name != symbol_short!("transfer") {
        return Err(AmbitError::FunctionNotAllowed);
    }
    let (from, to, amount) = transfer_args(e, &call.args)?;
    if from != *smart_account {
        return Err(AmbitError::FromNotAccount);
    }
    check_payee_and_amount(config, &to, amount)
}

/// Checks 4 and 5 only. Shared by `check` and the read-only `check_payment`.
pub fn check_payee_and_amount(
    config: &AmbitParams,
    to: &Address,
    amount: i128,
) -> Result<(), AmbitError> {
    if !config.payees.contains(to) {
        return Err(AmbitError::PayeeNotAllowed);
    }
    if amount <= 0 {
        return Err(AmbitError::AmountNotPositive);
    }
    if amount > config.max_per_payment {
        return Err(AmbitError::AmountAboveCap);
    }
    Ok(())
}

/// Decodes `transfer(from: Address, to: Address, amount: i128)`. Any other shape is refused,
/// including a muxed `to`, so a call the policy cannot read never passes.
fn transfer_args(e: &Env, args: &Vec<Val>) -> Result<(Address, Address, i128), AmbitError> {
    if args.len() != 3 {
        return Err(AmbitError::BadArgs);
    }
    let from = Address::try_from_val(e, &args.get_unchecked(0)).map_err(|_| AmbitError::BadArgs)?;
    let to = Address::try_from_val(e, &args.get_unchecked(1)).map_err(|_| AmbitError::BadArgs)?;
    let amount = i128::try_from_val(e, &args.get_unchecked(2)).map_err(|_| AmbitError::BadArgs)?;
    Ok((from, to, amount))
}
