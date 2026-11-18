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

## Testnet tests

```sh
pnpm test:testnet
```

Deploys a fresh account with fresh keys and checks the WASM hash and the Default rule. Not part
of `pnpm test`, which stays offline.
