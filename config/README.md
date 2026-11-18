# Network config

`networks.json` is the single place for per-network addresses. Every package reads it, nothing
hardcodes an address.

- `null` means not filled yet. Code must refuse to run on a network with a `null` it needs.
- `usdcIssuer`, `usdcSac`: USDC issuer and its Stellar Asset Contract ID.
- `accountWasmHash`: the stock OpenZeppelin v0.8.0 `multisig-account-example` build.
  The CLI and dashboard refuse accounts with any other hash.
- `verifiers`, `policies`: deployed contract addresses.
- `mainnet.rpcUrl`: provider not chosen yet.

## Sources (testnet, checked 2026-11-19)

| Field                                                    | Source                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `usdcIssuer`                                             | [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)                           |
| `usdcSac`                                                | `stellar contract id asset --network testnet --asset USDC:<usdcIssuer>`                                                       |
| `accountWasmHash`, `verifiers`, `policies.spendingLimit` | Testnet deployments published by [Smart Account Kit](https://github.com/stellar/smart-account-kit) for `stellar-accounts` 0.8 |

Each contract's WASM was fetched back from testnet and hashed:

| Contract              | WASM SHA-256                                                       |
| --------------------- | ------------------------------------------------------------------ |
| ed25519 verifier      | `60e8798db610bdaf3370d39ebda56ee1dc2c15ce1c3a9e28b528bfa24a06b477` |
| WebAuthn verifier     | `e63a030d0f1a1481e36059a4837c433083b33e704c1f9625b7314795b6d72b76` |
| spending-limit policy | `9bc17db0a804d6c82231a268c43bac1413650ea92cac0022e0d0a3b66ddc8189` |

```sh
stellar contract fetch --network testnet --id <address> | shasum -a 256
```

The verifiers are an earlier build than 0.8.0. Their source did not change in 0.8.0, and the
verifier address is part of every External signer identity, so the existing deployments are kept.

Testnet is reset from time to time. After a reset these addresses are gone and must be redeployed.
