use soroban_sdk::contracterror;

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AmbitError {
    /// No config for this account and rule: never installed, or uninstalled.
    NotInstalled = 9001,

    /// Not a contract call, or not a call to the rule's asset contract.
    WrongContext = 9002,

    /// Any function other than `transfer`.
    FunctionNotAllowed = 9003,

    /// The call arguments do not decode as `transfer(from, to, amount)`.
    BadArgs = 9004,

    /// `from` is not the smart account itself.
    FromNotAccount = 9005,

    /// `to` is not in the payee allow-list.
    PayeeNotAllowed = 9006,

    /// `amount` is zero or negative.
    AmountNotPositive = 9007,

    /// `amount` is above the cap per payment.
    AmountAboveCap = 9008,

    /// Install parameters are invalid.
    InvalidParams = 9009,

    /// The policy is already installed for this account and rule.
    AlreadyInstalled = 9010,
}
