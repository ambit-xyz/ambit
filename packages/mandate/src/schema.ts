import { AMOUNT_PATTERN } from "./amount.js";

// Shape only. Address checksums, amounts, dates and cross-field rules are in `validate.ts`.
const ACCOUNT = "^G[A-Z2-7]{55}$";
const CONTRACT = "^C[A-Z2-7]{55}$";
const ACCOUNT_OR_CONTRACT = "^[GC][A-Z2-7]{55}$";
const RFC3339 =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$";

const amount = { type: "string", pattern: AMOUNT_PATTERN } as const;
const date = { type: "string", pattern: RFC3339 } as const;

/** JSON Schema (draft 2020-12) for `ambit-mandate/0`. */
export const mandateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "ambit-mandate/0",
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "id",
    "network",
    "account",
    "agent",
    "asset",
    "limits",
    "payees",
    "validUntil",
    "description",
  ],
  properties: {
    version: { const: "ambit-mandate/0" },
    id: { type: "string", pattern: "^[a-z0-9-]{1,32}$" },
    network: { enum: ["testnet", "mainnet"] },
    account: { type: "string", pattern: CONTRACT },
    agent: {
      type: "object",
      additionalProperties: false,
      required: ["label", "signer"],
      properties: {
        label: { type: "string", minLength: 1, maxLength: 32 },
        signer: {
          type: "object",
          additionalProperties: false,
          required: ["type", "publicKey"],
          properties: {
            type: { const: "ed25519" },
            publicKey: { type: "string", pattern: ACCOUNT },
          },
        },
      },
    },
    asset: {
      type: "object",
      additionalProperties: false,
      required: ["code", "contract"],
      properties: {
        code: { type: "string", minLength: 1 },
        contract: { type: "string", pattern: CONTRACT },
      },
    },
    limits: {
      type: "object",
      additionalProperties: false,
      required: ["maxPerPayment", "maxPerPeriod", "period"],
      properties: {
        maxPerPayment: amount,
        maxPerPeriod: amount,
        period: { enum: ["1h", "1d", "7d", "30d"] },
      },
    },
    payees: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", pattern: ACCOUNT_OR_CONTRACT },
    },
    validFrom: date,
    validUntil: date,
    description: { type: "string", maxLength: 280 },
  },
} as const;
