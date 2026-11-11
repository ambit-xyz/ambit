# CLAUDE.md — ambit (code)

Code repo for Ambit. This file is public. Keep it free of internal planning, schedules and
references to private documents. Team-only context goes in `CLAUDE.local.md`, which is gitignored.

## Rules

1. English only in code, comments, commits and docs.
2. Ambit is non-custodial. Never add code that holds keys or funds or submits a payment on a
   user's behalf.
3. On-chain enforcement is the security boundary. SDK pre-checks only explain refusals.
4. Dependency direction is strictly downward:
   `mcp`, `cli`, `dashboard` → `sdk` / `evidence` → `core` → `mandate`.
   `mandate` has no network code and must run in the browser and in Node.
5. No account contract here. Accounts are the stock OpenZeppelin v0.8.0 build.
6. Addresses live only in `config/networks.json`.
7. Do not bump `stellar-accounts` or `soroban-sdk` without an agreed decision. Versions are pinned
   in `Cargo.toml` and `Cargo.lock`.
8. Never commit keys, `.env` files, evidence logs or anything from private folders outside this repo.
9. Comments and docs describe the code, not internal plans: no schedule, milestone or private
   document references.
10. Work on a branch per change and open a pull request.

## Commands

| Task          | Command                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| Install       | `pnpm install`                                                                |
| Build TS      | `pnpm build`                                                                  |
| Test TS       | `pnpm test`                                                                   |
| Lint / format | `pnpm lint` / `pnpm format`                                                   |
| Dashboard     | `pnpm dashboard:dev`, `pnpm dashboard:build`                                  |
| Rust test     | `cargo test`                                                                  |
| Rust lint     | `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`     |
| WASM          | `stellar contract build` (plain `cargo build` for wasm fails, soroban-sdk 28) |
