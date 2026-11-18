// Stable error codes. CLI, SDK and dashboard show `message` and branch on `code`.

export const MESSAGES = {
  schema: "Field `{path}` is missing or has the wrong type.",
  unknownField: "Field `{path}` is not part of the mandate format.",
  invalidAddress: "Field `{path}` is not a valid Stellar address.",
  networkMismatch: "This mandate is for another network.",
  amountNotPositive: "Field `{path}` must be more than 0.",
  perPaymentAbovePeriod: "The cap per payment is larger than the cap per period.",
  pilotCap: "During the pilot a mandate can allow at most 100 USDC per period on mainnet.",
  assetNotSupported: "Only USDC is supported in this version.",
  assetContractMismatch: "This is not the USDC contract for this network.",
  payeeIsAccount: "The account cannot pay itself.",
  tooManyPayees: "At most 20 payees per mandate.",
  expired: "The end date is in the past.",
  endBeforeStart: "The end date is before the start date.",
  tooFar: "The end date is more than a year away.",
  duplicateAgent: "This agent already has an active mandate on this account. Revoke it first.",
} as const;

export type ErrorCode = keyof typeof MESSAGES;

export type MandateError = {
  code: ErrorCode;
  /** Dotted path of the field, for example `limits.maxPerPayment`. Empty for the whole mandate. */
  path: string;
  message: string;
};

export const mandateError = (code: ErrorCode, path = ""): MandateError => ({
  code,
  path,
  message: MESSAGES[code].replace("{path}", path),
});
