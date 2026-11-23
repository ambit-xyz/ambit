# Scripts

Deploy and maintenance scripts. Not published. Addresses come from `config/networks.json`.

## Deploy a smart account

```sh
pnpm deploy:account --network testnet --owner G... [--source <stellar keys identity>]
```

Deploys the stock OpenZeppelin account build (hash `accountWasmHash`) with one ed25519 owner
signer, registered as an External signer through the ed25519 verifier. The constructor creates
only the Default rule (id 0) with no policies and no expiry. Mandate rules are added later by the
owner.

- `--source` pays the fee. On testnet it can be left out: a throwaway key is created and funded by
  friendbot.
- The script prints the account address, the deploy tx hash, the WASM hash read back from the
  chain and the Default rule.
- The script never changes or removes the Default rule. An account without a valid Default rule
  cannot be managed again.

## Deploy ambit-policy

```sh
stellar contract build
pnpm deploy:policy --network testnet [--source <stellar keys identity>] [--write [--replace]]
```

Uploads `target/wasm32v1-none/release/ambit_policy.wasm` and creates a new instance of it, then
reads the WASM back from the chain and checks its hash.

- Every run is a new deployment with a new address. The contract cannot be upgraded, and mandates
  already installed keep the address they were created with.
- `--write` records the address in `policies.ambitPolicy` and the hash in `ambitPolicyWasmHash`
  in `config/networks.json`. If an address is already recorded, `--replace` is needed too.
- `--source` pays the fees. On testnet it can be left out, as for `deploy:account`.

## Compile a mandate

```sh
pnpm compile:mandate                                     # list the fixtures
pnpm compile:mandate basic                               # a fixture, latest testnet ledger
pnpm compile:mandate expired --ledger 1000000 --now 2026-11-20T00:00:00Z   # offline
pnpm compile:mandate ./my-mandate.json                   # any mandate file
```

Runs `compile` from `@ambit/mandate` on a mandate and prints the result: the rule, the
`ambit-policy` params and the spending-limit params of the two owner calls that would install it,
or the validation errors (exit code 1). Nothing is sent and no key is needed.

The mandate is either a `.json` file path or a fixture from `tests/fixtures/mandates/valid/` and
`invalid/`, named by any part of its file name that matches only one fixture: `basic`,
`valid/basic`, `smallest`, `expired`, `tooManyPayees`. A name that matches several (`schema`) or
none prints the candidates. With no argument, the script lists every fixture.

- `--ledger` and `--now` go together. Without them the latest ledger and its close time are read
  from the network's RPC, so `rule.validUntil` counts from the real ledger. With them nothing is
  read from the network and every run gives the same output.
- Addresses (USDC, verifier, policies) come from `config/networks.json` for `--network`
  (default `testnet`). Mainnet has no addresses there yet, so `--network mainnet` stops with
  "not set".
- A relative file path is taken from the repo root.
- Bytes print as hex and stroop amounts as decimal strings (20 USDC is `"200000000"`).
- The mandate package is rebuilt first, so the output reflects the current source.

## Compile vectors

```sh
python3 scripts/compile-vectors.py           # rewrite the vectors
python3 scripts/compile-vectors.py --check   # check the committed vectors are current
```

Writes `tests/fixtures/mandates/compile-vectors.json`: the expected `compile()` output of
`@ambit/mandate` for every fixture in `tests/fixtures/mandates/valid/`. It is a second
implementation of the compile rules in Python's standard library, sharing no code with the
package, so the compiler tests compare against values the compiler did not produce. Run it after
adding or changing a valid fixture, then `pnpm format`.

## Testnet tests

```sh
pnpm test:testnet
```

Not part of `pnpm test`, which stays offline. Every run uses fresh keys and a fresh account.

- `account.testnet.test.ts`: deploys an account, checks its WASM hash and the Default rule.
- `policy.testnet.test.ts`: checks the `ambit-policy` deployment in `config/networks.json`. It
  installs the policy on a new account next to the stock spending limit, then sends real
  payments: one inside the mandate goes through, a wrong payee, an amount above the cap and an
  `approve` are refused with the Ambit error code. The asset is a token the test issues, so no
  USDC is needed.

A refused payment fails simulation with `Error(Auth, InvalidAction)`. The policy's code
(for example `9006`) is in the simulation's diagnostic events, read by `contractErrorCodes`.
