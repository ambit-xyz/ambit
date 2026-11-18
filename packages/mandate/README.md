# @ambit/mandate

The `ambit-mandate/0` format: JSON Schema, validator and error codes. No network or file code,
runs in the browser and in Node.

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

- Amounts are decimal strings with at most 7 decimals, never JSON numbers.
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

## Error codes

| Code                    | Message                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `schema`                | Field `x` is missing or has the wrong type.                                  |
| `unknownField`          | Field `x` is not part of the mandate format.                                 |
| `invalidAddress`        | Field `x` is not a valid Stellar address.                                    |
| `networkMismatch`       | This mandate is for another network.                                         |
| `amountNotPositive`     | Field `x` must be more than 0.                                               |
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
