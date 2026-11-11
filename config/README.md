# Network config

`networks.json` is the single place for per-network addresses. Every package reads it, nothing
hardcodes an address.

- `null` means not filled yet. Code must refuse to run on a network with a `null` it needs.
- `usdcSac`: USDC Stellar Asset Contract ID, from Circle and Stellar docs.
- `accountWasmHash`: the stock OpenZeppelin v0.8.0 `multisig-account-example` build.
  The CLI and dashboard refuse accounts with any other hash.
- `verifiers`, `policies`: deployed contract addresses, filled by `scripts/` deploys.
- `mainnet.rpcUrl`: provider not chosen yet.
