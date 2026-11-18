# Ambit

Spending mandates for AI agents on Stellar. A business sets what an agent may pay (asset, cap per
payment, cap per period, payees, end date). The rules run inside an OpenZeppelin smart account,
so a payment outside the mandate never moves funds. Every attempt is written to an evidence log.

## Layout

```
contracts/ambit-policy   Rust, Soroban policy: payee allow-list, cap per payment, transfer only
packages/mandate         mandate schema, validator, hash, compiler (no network code)
packages/core            network config, RPC, account reader, pre-check
packages/sdk             ambit.fetch(), x402 and MPP adapters
packages/evidence        evidence writer, hash chain verify, export
packages/mcp             MCP server
packages/cli             `ambit` command
apps/dashboard           owner dashboard (Next.js, static export)
config/networks.json     per-network addresses
scripts/                 deploy scripts (smart account on testnet)
tests/                   e2e and shared fixtures
```

## Requirements

- Node 22.12 or later, pnpm 10
- Rust (version pinned in `rust-toolchain.toml`, installed by rustup), target `wasm32v1-none`
- `stellar-cli` 25.2.0 or later. soroban-sdk 28 builds WASM only through `stellar contract build`,
  plain `cargo build --target wasm32v1-none` fails

## Commands

```sh
pnpm install
pnpm build            # TypeScript packages
pnpm test             # vitest
pnpm lint             # biome
pnpm dashboard:dev
pnpm test:testnet     # needs network, deploys a fresh account on testnet
pnpm deploy:account --network testnet --owner G...

cargo test            # contracts
stellar contract build
```
