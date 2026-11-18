import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { toStroops } from "./amount.js";
import { type MandateError, mandateError } from "./errors.js";
import { mandateSchema } from "./schema.js";
import { isAccountAddress, isContractAddress } from "./strkey.js";
import type { Mandate, Network } from "./types.js";

export const MAX_PAYEES = 20;
export const MAX_VALID_DAYS = 366;
export const PILOT_CAP_STROOPS = toStroops("100");
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the validator needs from outside. Passed in so the package has no network or file code. */
export type ValidationContext = {
  network: Network;
  /** USDC Stellar Asset Contract for `network`, from the network config. */
  usdcSac: string;
  now: Date;
};

export type ValidationResult =
  | { ok: true; mandate: Mandate }
  | { ok: false; errors: MandateError[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkSchema = ajv.compile<Mandate>(mandateSchema);

/** "/limits/maxPerPayment" → "limits.maxPerPayment" */
const dotted = (pointer: string) => pointer.split("/").filter(Boolean).join(".");
const join = (parent: string, child: string) => (parent ? `${parent}.${child}` : child);

const fromAjv = (e: ErrorObject): MandateError => {
  const parent = dotted(e.instancePath);
  if (e.keyword === "required") {
    return mandateError("schema", join(parent, String(e.params.missingProperty)));
  }
  if (e.keyword === "additionalProperties") {
    return mandateError("unknownField", join(parent, String(e.params.additionalProperty)));
  }
  return mandateError("schema", parent);
};

const checkAddresses = (m: Mandate): MandateError[] => {
  const errors: MandateError[] = [];
  if (!isContractAddress(m.account)) errors.push(mandateError("invalidAddress", "account"));
  if (!isAccountAddress(m.agent.signer.publicKey)) {
    errors.push(mandateError("invalidAddress", "agent.signer.publicKey"));
  }
  if (!isContractAddress(m.asset.contract)) {
    errors.push(mandateError("invalidAddress", "asset.contract"));
  }
  m.payees.forEach((payee, i) => {
    if (!isAccountAddress(payee) && !isContractAddress(payee)) {
      errors.push(mandateError("invalidAddress", `payees.${i}`));
    }
  });
  return errors;
};

const checkAsset = (m: Mandate, ctx: ValidationContext): MandateError[] => {
  if (m.asset.code !== "USDC") return [mandateError("assetNotSupported", "asset.code")];
  if (m.asset.contract !== ctx.usdcSac) {
    return [mandateError("assetContractMismatch", "asset.contract")];
  }
  return [];
};

const checkLimits = (m: Mandate): MandateError[] => {
  const perPayment = toStroops(m.limits.maxPerPayment);
  const perPeriod = toStroops(m.limits.maxPerPeriod);
  const errors: MandateError[] = [];
  if (perPayment <= 0n) errors.push(mandateError("amountNotPositive", "limits.maxPerPayment"));
  if (perPeriod <= 0n) errors.push(mandateError("amountNotPositive", "limits.maxPerPeriod"));
  if (perPayment > perPeriod) errors.push(mandateError("perPaymentAbovePeriod", "limits"));
  if (m.network === "mainnet" && perPeriod > PILOT_CAP_STROOPS) {
    errors.push(mandateError("pilotCap", "limits.maxPerPeriod"));
  }
  return errors;
};

const checkPayees = (m: Mandate): MandateError[] => {
  const errors: MandateError[] = [];
  if (m.payees.length > MAX_PAYEES) errors.push(mandateError("tooManyPayees", "payees"));
  if (m.payees.includes(m.account)) errors.push(mandateError("payeeIsAccount", "payees"));
  return errors;
};

const checkDates = (m: Mandate, ctx: ValidationContext): MandateError[] => {
  const until = Date.parse(m.validUntil);
  const from = m.validFrom === undefined ? ctx.now.getTime() : Date.parse(m.validFrom);
  // The pattern accepts shapes like month 13. Date.parse rejects them.
  if (Number.isNaN(until)) return [mandateError("schema", "validUntil")];
  if (Number.isNaN(from)) return [mandateError("schema", "validFrom")];
  if (until <= ctx.now.getTime()) return [mandateError("expired", "validUntil")];
  if (until <= from) return [mandateError("endBeforeStart", "validUntil")];
  if (until > ctx.now.getTime() + MAX_VALID_DAYS * DAY_MS) {
    return [mandateError("tooFar", "validUntil")];
  }
  return [];
};

/**
 * Validates a parsed mandate. Shape first (JSON Schema). If the shape is wrong, stop there:
 * the other checks need the right types. Otherwise run every check and return all errors.
 */
export const validateMandate = (input: unknown, ctx: ValidationContext): ValidationResult => {
  if (!checkSchema(input)) {
    return { ok: false, errors: (checkSchema.errors ?? []).map(fromAjv) };
  }
  const m = input;
  const errors = [
    ...(m.network === ctx.network ? [] : [mandateError("networkMismatch", "network")]),
    ...checkAddresses(m),
    ...checkAsset(m, ctx),
    ...checkLimits(m),
    ...checkPayees(m),
    ...checkDates(m, ctx),
  ];
  return errors.length === 0 ? { ok: true, mandate: m } : { ok: false, errors };
};
