# Network config

`networks.json` is the single place for per-network addresses. Every package reads it, nothing
hardcodes an address.

- `null` means not filled yet. Code must refuse to run on a network with a `null` it needs.
- `usdcIssuer`, `usdcSac`: USDC issuer and its Stellar Asset Contract ID.
- `accountWasmHash`: the stock OpenZeppelin v0.8.0 `multisig-account-example` build.
  The CLI and dashboard refuse accounts with any other hash.
- `ambitPolicyWasmHash`: SHA-256 of the `ambit-policy` WASM deployed at `policies.ambitPolicy`.
- `verifiers`, `policies`: deployed contract addresses.
- `mainnet.rpcUrl`: provider not chosen yet.

## Sources (testnet, checked 2026-11-19)

| Field                                                    | Source                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `usdcIssuer`                                             | [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)                           |
| `usdcSac`                                                | `stellar contract id asset --network testnet --asset USDC:<usdcIssuer>`                                                       |
| `accountWasmHash`, `verifiers`, `policies.spendingLimit` | Testnet deployments published by [Smart Account Kit](https://github.com/stellar/smart-account-kit) for `stellar-accounts` 0.8 |

`policies.ambitPolicy` and `ambitPolicyWasmHash` are written by `pnpm deploy:policy --write`
(see `scripts/README.md`). The current testnet instance was deployed on 2026-11-23:

| Field                  | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `policies.ambitPolicy` | `CCDDPMZCUOVF6Z7OZOJ2PRJ4J2POV645G5IZCEAIYRVPDN6KBCN2AELA`         |
| `ambitPolicyWasmHash`  | `036e054d62703b397d43e8554ac57c14f3b0116c81f6f5ddb12c487a23647522` |
| Upload tx              | `7dd8a5093815d748554fd4439054a771c2d080c6026295d361157cc77a19b15a` |
| Deploy tx              | `aec07151a3a6ef54659714884c72ecdf0d65fb91678bf698c244905661ef0cd7` |

The previous instance, `CC2WZIPBL5HONQMDOIWTW7ZS5IN7MFOZCU7554RQ7KHPRSI52GXLLPBE` (WASM
`f991b6363cf78d448e99bc8af80f26d9b90adddb54f4c995a34885fea305e994`, deployed 2026-11-19), must
not be used. It accepts a payment that no signer of the rule signed, so a rule where it is the
only policy can be spent by anyone, within its payee list and cap per payment.

Built with `stellar contract build` (stellar-cli 27.1.0, Rust 1.99.0 from `rust-toolchain.toml`).
The contract has no admin and no upgrade function. A new version is a new deployment with a new
address.

Each contract's WASM was fetched back from testnet and hashed:

| Contract              | WASM SHA-256                                                       |
| --------------------- | ------------------------------------------------------------------ |
| ed25519 verifier      | `60e8798db610bdaf3370d39ebda56ee1dc2c15ce1c3a9e28b528bfa24a06b477` |
| WebAuthn verifier     | `e63a030d0f1a1481e36059a4837c433083b33e704c1f9625b7314795b6d72b76` |
| spending-limit policy | `9bc17db0a804d6c82231a268c43bac1413650ea92cac0022e0d0a3b66ddc8189` |
| `ambit-policy`        | `036e054d62703b397d43e8554ac57c14f3b0116c81f6f5ddb12c487a23647522` |

```sh
stellar contract fetch --network testnet --id <address> | shasum -a 256
```

The verifiers are an earlier build than 0.8.0. Their source did not change in 0.8.0, and the
verifier address is part of every External signer identity, so the existing deployments are kept.

Testnet is reset from time to time. After a reset these addresses are gone and must be redeployed.
