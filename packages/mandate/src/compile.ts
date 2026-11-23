// Turns a mandate into the parameters of the two owner calls that install it:
//
//   1. account.add_context_rule(contextType, name, validUntil, signers, { ambitPolicy: ambitPolicyParams })
//   2. account.add_policy(ruleId, spendingLimit, spendingLimitParams)
//
// `ambit-policy` is the only policy of call 1 so that it runs before the spending limit, which
// call 2 appends. `ruleId` is returned by call 1, so it is not part of this output.
//
// The output is plain data: amounts are bigint stroops, keys and hashes are bytes, addresses are
// strings.
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { toStroops } from "./amount.js";
import type { MandateError } from "./errors.js";
import { mandateHashBytes } from "./hash.js";
import { accountPublicKey, isContractAddress } from "./strkey.js";
import type { Period } from "./types.js";
import { type ValidationContext, validateMandate } from "./validate.js";

export const LEDGER_SECONDS = 5;

/** Length of a spending-limit period in ledgers, at 5 seconds per ledger. */
export const PERIOD_LEDGERS: Readonly<Record<Period, number>> = {
  "1h": 720,
  "1d": 17_280,
  "7d": 120_960,
  "30d": 518_400,
};

/** OpenZeppelin smart account limits per context rule (`stellar-accounts` 0.8). */
export const MAX_RULE_NAME_BYTES = 20;
export const MAX_RULE_SIGNERS = 15;
export const MAX_RULE_POLICIES = 5;

/** Prefix of every mandate rule name. The rest is the first 8 hex characters of the hash. */
export const RULE_NAME_PREFIX = "ambit:";

const U32_MAX = 0xffff_ffff;

/**
 * What the compiler needs from outside: the validation context plus the ledger the date maths
 * starts from and the contracts the rule points to. The caller reads `currentLedger` and `now`
 * together (for example the latest ledger and its close time), so the output does not depend on
 * when this function runs.
 */
export type CompileContext = ValidationContext & {
  currentLedger: number;
  /** Defaults to `LEDGER_SECONDS`. */
  ledgerSeconds?: number;
  ed25519Verifier: string;
  ambitPolicy: string;
  spendingLimit: string;
};

/** `Signer::External(verifier, key_data)` with the agent's raw ed25519 public key. */
export type ExternalSigner = {
  type: "External";
  verifier: string;
  publicKey: Uint8Array;
};

/** `AmbitParams` of `ambit-policy`, installed with call 1. */
export type AmbitPolicyParams = {
  mandateHash: Uint8Array;
  maxPerPayment: bigint;
  payees: string[];
};

/** `SpendingLimitAccountParams` of the stock spending limit, installed with call 2. */
export type SpendingLimitParams = {
  spendingLimit: bigint;
  periodLedgers: number;
};

/** Arguments of call 1, `add_context_rule`. Its policy map is `{ [policy]: ambitPolicyParams }`. */
export type CompiledRule = {
  contextType: { type: "CallContract"; contract: string };
  /** `ambit:` + first 8 hex characters of the mandate hash. 14 bytes. */
  name: string;
  /** Last ledger the rule is valid in. Approximate: about `validUntil` at the assumed close time. */
  validUntil: number;
  signers: ExternalSigner[];
  policies: string[];
};

export type CompiledMandate = {
  account: string;
  mandateHash: string;
  rule: CompiledRule;
  ambitPolicyParams: AmbitPolicyParams;
  spendingLimitPolicy: string;
  spendingLimitParams: SpendingLimitParams;
};

export type CompileResult =
  | { ok: true; compiled: CompiledMandate }
  | { ok: false; errors: MandateError[] };

const assertContext = (ctx: CompileContext, ledgerSeconds: number) => {
  if (!Number.isInteger(ctx.currentLedger) || ctx.currentLedger < 0) {
    throw new RangeError(`currentLedger must be a ledger sequence: ${ctx.currentLedger}`);
  }
  if (!Number.isInteger(ledgerSeconds) || ledgerSeconds <= 0) {
    throw new RangeError(`ledgerSeconds must be a positive integer: ${ledgerSeconds}`);
  }
  if (Number.isNaN(ctx.now.getTime())) throw new RangeError("now is not a valid date");
  for (const name of ["ed25519Verifier", "ambitPolicy", "spendingLimit"] as const) {
    if (!isContractAddress(ctx[name])) throw new TypeError(`${name} is not a contract address`);
  }
};

/**
 * Rounding up can add at most one ledger past the written end date.
 */
const toLedger = (validUntil: string, ctx: CompileContext, ledgerSeconds: number): number => {
  const remainingMs = Date.parse(validUntil) - ctx.now.getTime();
  const ledgerMs = ledgerSeconds * 1000;
  const ledger = ctx.currentLedger + Math.floor((remainingMs + ledgerMs - 1) / ledgerMs);
  if (ledger > U32_MAX) throw new RangeError(`valid_until does not fit in a ledger: ${ledger}`);
  return ledger;
};

export const compile = (input: unknown, ctx: CompileContext): CompileResult => {
  const ledgerSeconds = ctx.ledgerSeconds ?? LEDGER_SECONDS;
  assertContext(ctx, ledgerSeconds);

  const validated = validateMandate(input, ctx);
  if (!validated.ok) return validated;
  const m = validated.mandate;

  const hash = mandateHashBytes(m);
  const hashHex = bytesToHex(hash);
  const name = RULE_NAME_PREFIX + hashHex.slice(0, 8);

  const rule: CompiledRule = {
    contextType: { type: "CallContract", contract: m.asset.contract },
    name,
    validUntil: toLedger(m.validUntil, ctx, ledgerSeconds),
    signers: [
      {
        type: "External",
        verifier: ctx.ed25519Verifier,
        publicKey: accountPublicKey(m.agent.signer.publicKey),
      },
    ],
    policies: [ctx.ambitPolicy],
  };

  // Hold by construction. Checked so a future change cannot install a rule the account refuses.
  if (utf8ToBytes(name).length > MAX_RULE_NAME_BYTES)
    throw new Error(`rule name too long: ${name}`);
  if (rule.signers.length > MAX_RULE_SIGNERS) throw new Error("too many signers for one rule");
  if (rule.policies.length + 1 > MAX_RULE_POLICIES)
    throw new Error("too many policies for one rule");

  return {
    ok: true,
    compiled: {
      account: m.account,
      mandateHash: hashHex,
      rule,
      ambitPolicyParams: {
        mandateHash: hash.slice(),
        maxPerPayment: toStroops(m.limits.maxPerPayment),
        payees: [...m.payees],
      },
      spendingLimitPolicy: ctx.spendingLimit,
      spendingLimitParams: {
        spendingLimit: toStroops(m.limits.maxPerPeriod),
        periodLedgers: PERIOD_LEDGERS[m.limits.period],
      },
    },
  };
};
