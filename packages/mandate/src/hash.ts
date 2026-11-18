import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalize } from "./canonical.js";
import type { Mandate } from "./types.js";

/**
 * SHA-256 of the RFC 8785 canonical JSON of a mandate, UTF-8 encoded. Covers every field,
 * `description` included, so any change gives a new hash. Call it on a validated mandate.
 */
export const mandateHashBytes = (mandate: Mandate): Uint8Array =>
  sha256(utf8ToBytes(canonicalize(mandate)));

/** `mandateHashBytes` as 64 lowercase hex characters. */
export const mandateHash = (mandate: Mandate): string => bytesToHex(mandateHashBytes(mandate));
