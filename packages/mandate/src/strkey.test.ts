import { describe, expect, it } from "vitest";
import { isAccountAddress, isContractAddress } from "./strkey.js";

const ACCOUNT = "GCIH3MURWFMXVT6IDMJLGMJETA5C7YRFIJ6ETUJL372UCJAVU35VN7RI";
const CONTRACT = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

describe("strkey", () => {
  it("accepts valid addresses of the right kind", () => {
    expect(isAccountAddress(ACCOUNT)).toBe(true);
    expect(isContractAddress(CONTRACT)).toBe(true);
  });

  it("refuses the other kind", () => {
    expect(isAccountAddress(CONTRACT)).toBe(false);
    expect(isContractAddress(ACCOUNT)).toBe(false);
  });

  it("refuses a wrong checksum, length or character", () => {
    expect(isAccountAddress(`${ACCOUNT.slice(0, -1)}A`)).toBe(false);
    expect(isAccountAddress(ACCOUNT.slice(0, -1))).toBe(false);
    expect(isAccountAddress(ACCOUNT.toLowerCase())).toBe(false);
  });
});
