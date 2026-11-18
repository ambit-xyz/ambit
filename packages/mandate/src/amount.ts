// Amounts are decimal strings. On-chain they are i128 in stroops: 1 unit = 10^7 stroops.

export const DECIMALS = 7;

/** Up to 7 decimals, no sign, no exponent, no leading zeros ("0.5" is fine, "00.5" is not). */
export const AMOUNT_PATTERN = "^(0|[1-9][0-9]*)(\\.[0-9]{1,7})?$";

const AMOUNT_REGEX = new RegExp(AMOUNT_PATTERN);

/** Converts "12.5" to 125000000n. Exact, no floating point. Throws on an invalid amount. */
export const toStroops = (amount: string): bigint => {
  if (!AMOUNT_REGEX.test(amount)) throw new Error(`invalid amount: ${amount}`);
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 10n ** BigInt(DECIMALS) + BigInt(fraction.padEnd(DECIMALS, "0"));
};
