import { readdirSync, readFileSync } from "node:fs";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { I128_MAX } from "./amount.js";
import {
  type CompileContext,
  type CompiledMandate,
  compile,
  MAX_RULE_NAME_BYTES,
  MAX_RULE_POLICIES,
  MAX_RULE_SIGNERS,
  PERIOD_LEDGERS,
} from "./compile.js";
import type { Mandate } from "./types.js";
import { validateMandate } from "./validate.js";

const FIXTURES = new URL("../../../tests/fixtures/mandates/", import.meta.url);
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8")) as unknown;

type JsonContext = Omit<CompileContext, "now"> & { now: string };
type Vectors = {
  context: Record<"testnet" | "mainnet", JsonContext>;
  vectors: { fixture: string; compiled: unknown }[];
};

// Expected outputs are written by `scripts/compile-vectors.py`, an independent reference in
// Python with no code shared with this package, for a fixed context.
const { context, vectors } = read("compile-vectors.json") as Vectors;

const ctxFor = (mandate: unknown): CompileContext => {
  const network = (mandate as { network?: string }).network === "mainnet" ? "mainnet" : "testnet";
  const { now, ...rest } = context[network];
  return { ...rest, now: new Date(now) };
};

/** The output in the vector file's JSON form: bytes as hex, bigints as decimal strings. */
const toJson = (c: CompiledMandate) => ({
  ...c,
  rule: {
    ...c.rule,
    signers: c.rule.signers.map((s) => ({ ...s, publicKey: bytesToHex(s.publicKey) })),
  },
  ambitPolicyParams: {
    ...c.ambitPolicyParams,
    mandateHash: bytesToHex(c.ambitPolicyParams.mandateHash),
    maxPerPayment: c.ambitPolicyParams.maxPerPayment.toString(),
  },
  spendingLimitParams: {
    ...c.spendingLimitParams,
    spendingLimit: c.spendingLimitParams.spendingLimit.toString(),
  },
});

const compiled = (input: unknown, ctx = ctxFor(input)): CompiledMandate => {
  const result = compile(input, ctx);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result.compiled;
};

const basic = read("valid/basic.json") as Mandate;
const withLimits = (limits: Partial<Mandate["limits"]>): Mandate => ({
  ...basic,
  limits: { ...basic.limits, ...limits },
});
const errorCodes = (input: unknown) => {
  const result = compile(input, ctxFor(input));
  return result.ok ? [] : result.errors.map((e) => e.code);
};

describe("compile vectors", () => {
  const valid = readdirSync(new URL("valid", FIXTURES)).filter((f) => f.endsWith(".json"));

  it("has one vector per valid fixture", () => {
    expect(vectors.map((v) => v.fixture).sort()).toEqual(valid.map((f) => `valid/${f}`).sort());
  });

  it.each(vectors)("$fixture compiles to the expected output", ({ fixture, compiled: want }) => {
    expect(toJson(compiled(read(fixture)))).toEqual(want);
  });
});

describe("purity", () => {
  it.each(vectors)("$fixture gives identical output twice", ({ fixture }) => {
    const input = read(fixture);
    const a = compiled(input);
    const b = compiled(structuredClone(input));
    expect(b).toEqual(a);
    expect(JSON.stringify(toJson(b))).toBe(JSON.stringify(toJson(a)));
  });

  it("does not change its input or context", () => {
    const input = structuredClone(basic);
    const ctx = ctxFor(input);
    const before = JSON.stringify({ input, ctx });
    compile(input, ctx);
    expect(JSON.stringify({ input, ctx })).toBe(before);
  });

  it("returns arrays the caller can change without touching the input", () => {
    const input = structuredClone(basic);
    const out = compiled(input);
    out.ambitPolicyParams.payees.push("changed");
    expect(input.payees).toEqual(basic.payees);
  });

  it("does not read the clock", () => {
    const ctx = ctxFor(basic);
    const first = compiled(basic, ctx);
    const realNow = Date.now;
    Date.now = () => 0;
    try {
      expect(compiled(basic, ctx)).toEqual(first);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("stroops", () => {
  it.each([
    ["0.0000001", 1n],
    ["12.5", 125_000_000n],
    ["0.1234567", 1_234_567n],
    ["99.9999999", 999_999_999n],
  ])("%s → %s stroops", (amount, stroops) => {
    const out = compiled(withLimits({ maxPerPayment: amount, maxPerPeriod: amount }));
    expect(out.ambitPolicyParams.maxPerPayment).toBe(stroops);
    expect(out.spendingLimitParams.spendingLimit).toBe(stroops);
  });

  it("refuses 8 decimals", () => {
    expect(errorCodes(withLimits({ maxPerPayment: "0.00000001" }))).toEqual(["schema"]);
  });

  it("keeps large values exact, up to i128::MAX stroops", () => {
    const max = "17014118346046923173168730371588.4105727"; // i128::MAX / 10^7
    const out = compiled(withLimits({ maxPerPayment: "9007199254740993", maxPerPeriod: max }));
    expect(out.ambitPolicyParams.maxPerPayment).toBe(90_071_992_547_409_930_000_000n);
    expect(out.spendingLimitParams.spendingLimit).toBe(I128_MAX);
  });

  it("refuses amounts above i128::MAX stroops", () => {
    const over = "17014118346046923173168730371588.4105728";
    expect(errorCodes(withLimits({ maxPerPeriod: over }))).toEqual(["amountTooLarge"]);
    expect(errorCodes(withLimits({ maxPerPayment: over, maxPerPeriod: over }))).toEqual([
      "amountTooLarge",
      "amountTooLarge",
    ]);
  });
});

describe("ledgers", () => {
  it("maps each period to its ledger count", () => {
    expect(PERIOD_LEDGERS).toEqual({ "1h": 720, "1d": 17_280, "7d": 120_960, "30d": 518_400 });
    for (const period of ["1h", "1d", "7d", "30d"] as const) {
      expect(compiled(withLimits({ period })).spendingLimitParams.periodLedgers).toBe(
        PERIOD_LEDGERS[period],
      );
    }
  });

  // now is 2026-11-20T00:00:00Z in the test context, the current ledger 1,000,000.
  it.each([
    ["2026-11-20T00:00:01Z", 1],
    ["2026-11-20T00:00:05Z", 1],
    ["2026-11-20T00:00:06Z", 2],
    ["2026-11-20T00:00:10Z", 2],
    ["2026-11-20T00:00:11Z", 3],
    ["2026-11-20T00:00:14.999Z", 3],
    ["2026-11-21T00:00:00Z", 17_280],
  ])("valid until %s is current ledger + %i (rounded up)", (validUntil, ledgers) => {
    const { validFrom: _, ...rest } = basic;
    expect(compiled({ ...rest, validUntil }).rule.validUntil).toBe(1_000_000 + ledgers);
  });

  it("uses ledgerSeconds from the context", () => {
    const { validFrom: _, ...rest } = basic;
    const input = { ...rest, validUntil: "2026-11-20T00:01:00Z" };
    expect(compiled(input, { ...ctxFor(input), ledgerSeconds: 6 }).rule.validUntil).toBe(1_000_010);
  });

  it("fits the furthest end date in a u32 ledger", () => {
    const { validFrom: _, ...rest } = basic;
    const input = { ...rest, validUntil: "2027-11-21T00:00:00Z" }; // 366 days
    const out = compiled(input, { ...ctxFor(input), currentLedger: 0xffff_ffff - 6_324_480 });
    expect(out.rule.validUntil).toBe(0xffff_ffff);
    expect(() => compile(input, { ...ctxFor(input), currentLedger: 0xffff_ffff })).toThrow(
      RangeError,
    );
  });
});

describe("rule", () => {
  it.each(vectors)("$fixture has a name of at most 20 bytes", ({ fixture }) => {
    const out = compiled(read(fixture));
    expect(Buffer.byteLength(out.rule.name, "utf8")).toBe(14);
    expect(Buffer.byteLength(out.rule.name, "utf8")).toBeLessThanOrEqual(MAX_RULE_NAME_BYTES);
    expect(out.rule.name).toMatch(/^ambit:[0-9a-f]{8}$/);
    expect(out.rule.name).toBe(`ambit:${out.mandateHash.slice(0, 8)}`);
  });

  it("stays within the account's signer and policy limits", () => {
    const out = compiled(basic);
    expect(out.rule.signers.length).toBeLessThanOrEqual(MAX_RULE_SIGNERS);
    // ambit-policy with the rule, the spending limit added after it.
    expect(out.rule.policies.length + 1).toBeLessThanOrEqual(MAX_RULE_POLICIES);
  });

  it("installs ambit-policy with the rule and the spending limit separately", () => {
    const ctx = ctxFor(basic);
    const out = compiled(basic, ctx);
    expect(out.rule.policies).toEqual([ctx.ambitPolicy]);
    expect(out.spendingLimitPolicy).toBe(ctx.spendingLimit);
  });

  it("uses the same hash in the name and the policy params", () => {
    const out = compiled(basic);
    expect(bytesToHex(out.ambitPolicyParams.mandateHash)).toBe(out.mandateHash);
  });

  it("keeps off-chain fields off-chain", () => {
    const a = compiled(basic);
    const b = compiled({
      ...basic,
      id: "other-id",
      description: "Other text",
      agent: { ...basic.agent, label: "other-label" },
    });
    expect(b.mandateHash).not.toBe(a.mandateHash);
    expect(b.rule.name).not.toBe(a.rule.name);
    expect({ ...b.rule, name: "" }).toEqual({ ...a.rule, name: "" });
    expect(b.spendingLimitParams).toEqual(a.spendingLimitParams);
    expect({ ...b.ambitPolicyParams, mandateHash: null }).toEqual({
      ...a.ambitPolicyParams,
      mandateHash: null,
    });
  });
});

describe("invalid input", () => {
  const invalid = readdirSync(new URL("invalid", FIXTURES)).filter((f) => f.endsWith(".json"));

  it.each(invalid)("%s gives the validator's errors and no output", (file) => {
    const input = read(`invalid/${file}`);
    const ctx = ctxFor(input);
    expect(compile(input, ctx)).toEqual(validateMandate(input, ctx));
    expect(compile(input, ctx).ok).toBe(false);
  });

  it("throws on a context that is not usable", () => {
    const ctx = ctxFor(basic);
    expect(() => compile(basic, { ...ctx, currentLedger: -1 })).toThrow(RangeError);
    expect(() => compile(basic, { ...ctx, currentLedger: 1.5 })).toThrow(RangeError);
    expect(() => compile(basic, { ...ctx, ledgerSeconds: 0 })).toThrow(RangeError);
    expect(() => compile(basic, { ...ctx, now: new Date("bad") })).toThrow(RangeError);
    expect(() => compile(basic, { ...ctx, ambitPolicy: basic.payees[0] as string })).toThrow(
      TypeError,
    );
  });
});
