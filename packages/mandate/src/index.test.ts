import { describe, expect, it } from "vitest";
import { MANDATE_VERSION } from "./index.js";

describe("@ambit/mandate", () => {
  it("exposes the mandate format version", () => {
    expect(MANDATE_VERSION).toBe("ambit-mandate/0");
  });
});
