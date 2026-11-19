use soroban_sdk::{contractevent, Address, BytesN};

// Events are emitted only from `install` and `uninstall`, which run in owner transactions.
// `enforce` runs inside payments and must never emit one: x402 facilitators reject a payment
// whose simulation has any contract event other than the asset transfer.

/// Topics `("ambit", "installed")`.
#[contractevent(topics = ["ambit", "installed"])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Installed {
    pub smart_account: Address,
    pub rule_id: u32,
    pub mandate_hash: BytesN<32>,
}

/// Topics `("ambit", "uninstalled")`.
#[contractevent(topics = ["ambit", "uninstalled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Uninstalled {
    pub smart_account: Address,
    pub rule_id: u32,
}
