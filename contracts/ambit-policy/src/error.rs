use soroban_sdk::contracterror;

/// Refusal reasons. Codes start at 9000 so they never collide with the OpenZeppelin account
/// (3000 to 3018) or spending-limit (3220 to 3227) errors that can appear in the same
/// transaction.
#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
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

    /// No signer of the rule signed. On a rule with policies the account does not require its
    /// signers itself and leaves that to the policies, so an empty signer map reaches `enforce`.
    NoSigner = 9011,
}
