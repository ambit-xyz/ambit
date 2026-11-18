import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonical.js";

describe("canonicalize (RFC 8785)", () => {
  // RFC 8785 §3.2.2
  it("serializes the RFC example", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
        '"literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  // RFC 8785 §3.2.3: keys sorted by UTF-16 code units, not by code point or locale.
  it("sorts keys by UTF-16 code units", () => {
    const input = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh",' +
        '"1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control",' +
        '"\\u00f6":"Latin Small Letter O With Diaeresis"}',
    );
    // Expected order from the RFC. Built pair by pair because a JS object would move "1" first.
    const expected = [
      ["\r", "Carriage Return"],
      ["1", "One"],
      ["\u0080", "Control"],
      ["\u00f6", "Latin Small Letter O With Diaeresis"],
      ["\u20ac", "Euro Sign"],
      ["\ud83d\ude00", "Emoji: Grinning Face"],
      ["\ufb33", "Hebrew Letter Dalet With Dagesh"],
    ]
      .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
      .join(",");
    expect(canonicalize(input)).toBe(`{${expected}}`);
  });

  it("has no whitespace and keeps array order", () => {
    expect(canonicalize({ b: [3, 1, 2], a: { d: "x", c: "y" } })).toBe(
      '{"a":{"c":"y","d":"x"},"b":[3,1,2]}',
    );
  });

  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a function", () => 1],
    ["a Date", new Date(0)],
    ["a bigint", 1n],
    ["an undefined member", { a: undefined }],
  ])("refuses %s", (_, value) => {
    expect(() => canonicalize(value)).toThrow();
  });
});
