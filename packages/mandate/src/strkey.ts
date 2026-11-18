// Stellar StrKey checks without a network dependency.
// A G- or C-address is base32 of: version byte (1) + key or contract id (32) + CRC16 (2).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const VERSION_ACCOUNT = 6 << 3; // "G"
const VERSION_CONTRACT = 2 << 3; // "C"

const base32Decode = (input: string): Uint8Array | null => {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
};

/** CRC16-XModem, the checksum StrKey uses. */
const crc16 = (bytes: Uint8Array): number => {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
};

const isValid = (address: string, version: number): boolean => {
  if (address.length !== 56) return false;
  const bytes = base32Decode(address);
  if (bytes?.length !== 35 || bytes[0] !== version) return false;
  const body = bytes.subarray(0, 33);
  const checksum = (bytes[33] ?? 0) | ((bytes[34] ?? 0) << 8); // little endian
  return crc16(body) === checksum;
};

/** True for a valid ed25519 account address (G...). */
export const isAccountAddress = (address: string): boolean => isValid(address, VERSION_ACCOUNT);

/** True for a valid contract address (C...). */
export const isContractAddress = (address: string): boolean => isValid(address, VERSION_CONTRACT);
