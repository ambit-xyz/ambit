import { describe, expect, it } from "vitest";
import { toStroops } from "./amount.js";

describe("toStroops", () => {
  it.each([
    ["0", 0n],
    ["1", 10_000_000n],
    ["12.5", 125_000_000n],
    ["0.0000001", 1n],
    ["100.1234567", 1_001_234_567n],
    ["922337203685.4775807", 9_223_372_036_854_775_807n],
  ])("%s → %s", (amount, stroops) => {
    expect(toStroops(amount)).toBe(stroops);
  });

  it.each(["0.00000001", "-1", "1e3", "01", "1.", ".5", "", " 1"])("refuses %j", (amount) => {
    expect(() => toStroops(amount)).toThrow();
  });
});
