import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ValidationContext, validateMandate } from "./validate.js";

const FIXTURES = new URL("../../../tests/fixtures/mandates/", import.meta.url);

// Fixed inputs so the fixtures never expire. The mainnet USDC contract is a test value here,
// the real one comes from the network config.
const NOW = new Date("2026-11-20T00:00:00Z");
const USDC_SAC = {
  testnet: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  mainnet: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
} as const;

const ctxFor = (mandate: unknown): ValidationContext => {
  const network = (mandate as { network?: string }).network === "mainnet" ? "mainnet" : "testnet";
  return { network, usdcSac: USDC_SAC[network], now: NOW };
};

const load = (dir: "valid" | "invalid") =>
  readdirSync(new URL(dir, FIXTURES))
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      file,
      // File name is `<expectedCode>.<description>.json` for invalid fixtures.
      expected: file.split(".")[0],
      mandate: JSON.parse(readFileSync(new URL(`${dir}/${file}`, FIXTURES), "utf8")) as unknown,
    }));

describe("valid fixtures", () => {
  it.each(load("valid"))("$file passes", ({ mandate }) => {
    expect(validateMandate(mandate, ctxFor(mandate))).toEqual({ ok: true, mandate });
  });
});

describe("invalid fixtures", () => {
  it.each(load("invalid"))("$file fails with $expected only", ({ mandate, expected }) => {
    const result = validateMandate(mandate, ctxFor(mandate));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect([...new Set(result.errors.map((e) => e.code))]).toEqual([expected]);
  });
});

describe("validateMandate", () => {
  const basic = load("valid").find((f) => f.file === "basic.json")?.mandate;

  it("refuses a mandate for another network", () => {
    const result = validateMandate(basic, { ...ctxFor(basic), network: "mainnet" });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toContain("networkMismatch");
  });

  it("names the field in the error", () => {
    const result = validateMandate({ ...(basic as object), extra: 1 }, ctxFor(basic));
    expect(result).toEqual({
      ok: false,
      errors: [
        {
          code: "unknownField",
          path: "extra",
          message: "Field `extra` is not part of the mandate format.",
        },
      ],
    });
  });

  it("refuses input that is not an object", () => {
    expect(validateMandate("not a mandate", ctxFor({})).ok).toBe(false);
    expect(validateMandate(null, ctxFor({})).ok).toBe(false);
  });
});
