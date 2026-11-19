# Test WASM

Stock OpenZeppelin builds used by the tests in `../tests/`, so `ambit-policy` is tested inside the
same account, verifier and spending-limit policy that run on the network. Nothing here is built
from source in this repo.

| File                       | WASM SHA-256                                                       | Fetched from (testnet)                             |
| -------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| `oz_smart_account.wasm`    | `c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1` | `accountWasmHash` in `config/networks.json`        |
| `oz_ed25519_verifier.wasm` | `60e8798db610bdaf3370d39ebda56ee1dc2c15ce1c3a9e28b528bfa24a06b477` | `verifiers.ed25519` in `config/networks.json`      |
| `oz_spending_limit.wasm`   | `9bc17db0a804d6c82231a268c43bac1413650ea92cac0022e0d0a3b66ddc8189` | `policies.spendingLimit` in `config/networks.json` |

To fetch them again and check the hashes:

```sh
stellar contract fetch --network testnet --wasm-hash <accountWasmHash> -o oz_smart_account.wasm
stellar contract fetch --network testnet --id <verifiers.ed25519> -o oz_ed25519_verifier.wasm
stellar contract fetch --network testnet --id <policies.spendingLimit> -o oz_spending_limit.wasm
shasum -a 256 *.wasm
```

If a hash here stops matching `config/networks.json`, the tests no longer cover what is deployed.
