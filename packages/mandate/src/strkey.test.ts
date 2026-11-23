import { describe, expect, it } from "vitest";
import { accountPublicKey, isAccountAddress, isContractAddress } from "./strkey.js";

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

  it("decodes the 32-byte public key of an account address", () => {
    // Reference: Python base64.b32decode of the address, version byte and checksum dropped.
    const key = accountPublicKey("GAKD5Q6X55VDJYQZU46GXUPLGCY6NMDPWU26TZNH5EZEXMYILDCX2ELL");
    expect(Buffer.from(key).toString("hex")).toBe(
      "143ec3d7ef6a34e219a73c6bd1eb30b1e6b06fb535e9e5a7e9324bb30858c57d",
    );
  });

  it("refuses to decode anything but a valid account address", () => {
    expect(() => accountPublicKey(CONTRACT)).toThrow();
    expect(() => accountPublicKey(`${ACCOUNT.slice(0, -1)}A`)).toThrow();
  });
});
