# @ambit/mandate

The `ambit-mandate/0` format: JSON Schema, validator, error codes, hash and compiler. No network
or file code, runs in the browser and in Node.

## Example

```json
{
  "version": "ambit-mandate/0",
  "id": "research-agent-dec",
  "network": "testnet",
  "account": "CAWPGCR6NZXBN6HZ6A437EUGKWMEBC576SQFL2I666NUZWK2RCG53X7V",
  "agent": {
    "label": "research-agent",
    "signer": {
      "type": "ed25519",
      "publicKey": "GAKD5Q6X55VDJYQZU46GXUPLGCY6NMDPWU26TZNH5EZEXMYILDCX2ELL"
    }
  },
  "asset": {
    "code": "USDC",
    "contract": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
  },
  "limits": { "maxPerPayment": "20", "maxPerPeriod": "100", "period": "1d" },
  "payees": [
    "GCIH3MURWFMXVT6IDMJLGMJETA5C7YRFIJ6ETUJL372UCJAVU35VN7RI",
    "GCLU2QIYYIZU5RBKCF474MWUAOH76HRUOZM7JSXOMKV7O7YDDFPOXLZD"
  ],
  "validFrom": "2026-11-20T00:00:00Z",
  "validUntil": "2026-12-31T23:59:59Z",
  "description": "Pay for market data APIs used by the research agent"
}
```

The agent may pay the two payees in USDC, at most 20 per payment and 100 per day, until the end
of December. More examples: `tests/fixtures/mandates/valid/`.

## Rules

- Amounts are decimal strings with at most 7 decimals, never JSON numbers, and at most
  `i128::MAX` stroops.
- Unknown fields are an error, so a typo cannot silently drop a limit.
- `payees`: 1 to 20 unique G- or C-addresses, not the account itself.
- `validUntil` is after now and after `validFrom`, and at most 366 days ahead.
- On mainnet, `maxPerPeriod` is at most 100 during the pilot.

## Usage

```ts
import { validateMandate } from "@ambit/mandate";

const result = validateMandate(JSON.parse(text), {
  network: "testnet",
  usdcSac: config.testnet.usdcSac, // from config/networks.json
  now: new Date(),
});
if (!result.ok) {
  for (const e of result.errors) console.log(e.code, e.path, e.message);
}
```

## Hash

```ts
import { mandateHash, mandateHashBytes } from "@ambit/mandate";

mandateHash(mandate); // "803594ff35a70fcc3ca89feb8a54c2adf302354e3358d72c875757365dcc077d"
```

`mandateHash = SHA-256(UTF-8(RFC 8785 canonical JSON))`. The canonical form sorts object keys and
removes whitespace, so key order and formatting do not change the hash. Every field is covered,
`description` included, so any change gives a new hash and therefore a new mandate. Array order
is kept: listing the same payees in another order gives another hash. Validate first, then hash.

The hash is what goes on-chain. Anyone holding the mandate JSON can re-hash it and compare.
Fixed vectors: `tests/fixtures/mandates/hash-vectors.json`.

## Compile

`compile` validates a mandate and turns it into the parameters of the two owner calls that
install it on the smart account:

1. `add_context_rule(rule.contextType, rule.name, rule.validUntil, rule.signers, { [rule.policies[0]]: ambitPolicyParams })`
2. `add_policy(ruleId, spendingLimitPolicy, spendingLimitParams)`, where `ruleId` is what call 1
   returned.

`ambit-policy` is installed with the rule and the spending limit is added after it, so
`ambit-policy` runs first.

```ts
import { compile } from "@ambit/mandate";

const result = compile(JSON.parse(text), {
  network: "testnet",
  now: ledger.closeTime, // the time of `currentLedger`
  currentLedger: ledger.sequence,
  usdcSac: config.testnet.usdcSac, // all addresses from config/networks.json
  ed25519Verifier: config.testnet.verifiers.ed25519,
  ambitPolicy: config.testnet.policies.ambitPolicy,
  spendingLimit: config.testnet.policies.spendingLimit,
});
if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
const { rule, ambitPolicyParams, spendingLimitPolicy, spendingLimitParams } = result.compiled;
```

| Mandate                                         | Output                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `asset.contract`                                | `rule.contextType`: `CallContract(asset.contract)`                                       |
| `agent.signer.publicKey`                        | `rule.signers`: `External(ed25519Verifier, 32-byte public key)`                          |
| `validUntil`                                    | `rule.validUntil`: `currentLedger + ceil((validUntil - now) / 5 s)`                      |
| mandate hash                                    | `rule.name`: `ambit:` + first 8 hex characters (14 bytes, limit 20)                      |
| mandate hash, `maxPerPayment`, `payees`         | `ambitPolicyParams`, amounts in stroops (`bigint`)                                       |
| `maxPerPeriod`, `period`                        | `spendingLimitParams`, period `1h` 720, `1d` 17,280, `7d` 120,960, `30d` 518,400 ledgers |
| `id`, `description`, `agent.label`, `validFrom` | not on-chain                                                                             |

The output is plain data (`bigint`, `Uint8Array`, strings), not XDR. Encoding it for a
transaction is left to the caller, so this package has no Stellar SDK dependency.

`compile` is pure: it reads no clock, network or file, and the same input and context give the
same output. Pass `now` and `currentLedger` read together. Ledger close time is about 5 seconds
but not fixed, so `rule.validUntil` and the period are approximate, and rounding up can add one
ledger past the written end date. An invalid context (negative ledger, a G-address where a
contract is expected) throws.

Expected outputs for the valid fixtures: `tests/fixtures/mandates/compile-vectors.json`, computed
outside this code.

## Error codes

| Code                    | Message                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `schema`                | Field `x` is missing or has the wrong type.                                  |
| `unknownField`          | Field `x` is not part of the mandate format.                                 |
| `invalidAddress`        | Field `x` is not a valid Stellar address.                                    |
| `networkMismatch`       | This mandate is for another network.                                         |
| `amountNotPositive`     | Field `x` must be more than 0.                                               |
| `amountTooLarge`        | Field `x` is larger than the contracts can hold.                             |
| `perPaymentAbovePeriod` | The cap per payment is larger than the cap per period.                       |
| `pilotCap`              | During the pilot a mandate can allow at most 100 USDC per period on mainnet. |
| `assetNotSupported`     | Only USDC is supported in this version.                                      |
| `assetContractMismatch` | This is not the USDC contract for this network.                              |
| `payeeIsAccount`        | The account cannot pay itself.                                               |
| `tooManyPayees`         | At most 20 payees per mandate.                                               |
| `expired`               | The end date is in the past.                                                 |
| `endBeforeStart`        | The end date is before the start date.                                       |
| `tooFar`                | The end date is more than a year away.                                       |
| `duplicateAgent`        | This agent already has an active mandate on this account. Revoke it first.   |

`duplicateAgent` needs chain data, so this package defines it but does not produce it.
