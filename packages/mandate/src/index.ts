/** Mandate format version. */
export const MANDATE_VERSION = "ambit-mandate/0";

export { DECIMALS, I128_MAX, toStroops } from "./amount.js";
export { canonicalize } from "./canonical.js";
export {
  type AmbitPolicyParams,
  type CompileContext,
  type CompiledMandate,
  type CompiledRule,
  type CompileResult,
  compile,
  type ExternalSigner,
  LEDGER_SECONDS,
  MAX_RULE_NAME_BYTES,
  MAX_RULE_POLICIES,
  MAX_RULE_SIGNERS,
  PERIOD_LEDGERS,
  RULE_NAME_PREFIX,
  type SpendingLimitParams,
} from "./compile.js";
export { type ErrorCode, type MandateError, MESSAGES } from "./errors.js";
export { mandateHash, mandateHashBytes } from "./hash.js";
export { mandateSchema } from "./schema.js";
export { accountPublicKey, isAccountAddress, isContractAddress } from "./strkey.js";
export type { Mandate, Network, Period } from "./types.js";
export {
  MAX_PAYEES,
  MAX_VALID_DAYS,
  PILOT_CAP_STROOPS,
  type ValidationContext,
  type ValidationResult,
  validateMandate,
} from "./validate.js";
