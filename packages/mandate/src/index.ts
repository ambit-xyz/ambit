/** Mandate format version. */
export const MANDATE_VERSION = "ambit-mandate/0";

export { DECIMALS, toStroops } from "./amount.js";
export { canonicalize } from "./canonical.js";
export { type ErrorCode, type MandateError, MESSAGES } from "./errors.js";
export { mandateHash, mandateHashBytes } from "./hash.js";
export { mandateSchema } from "./schema.js";
export { isAccountAddress, isContractAddress } from "./strkey.js";
export type { Mandate, Network, Period } from "./types.js";
export {
  MAX_PAYEES,
  MAX_VALID_DAYS,
  PILOT_CAP_STROOPS,
  type ValidationContext,
  type ValidationResult,
  validateMandate,
} from "./validate.js";
