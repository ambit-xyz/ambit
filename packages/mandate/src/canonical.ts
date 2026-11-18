// JSON Canonicalization Scheme, RFC 8785 (JCS): https://www.rfc-editor.org/rfc/rfc8785
// One byte sequence for one JSON value, whatever the key order or whitespace of the source.
//
// - No whitespace.
// - Object keys sorted by UTF-16 code units (what `Array.prototype.sort` does by default).
// - Strings and numbers serialized as ECMAScript `JSON.stringify` does, which is what JCS
//   specifies.

/** Returns the RFC 8785 canonical JSON text. Throws on values JSON cannot represent. */
export const canonicalize = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`cannot canonicalize ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) throw new Error(`cannot canonicalize undefined at ${key}`);
        return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
      });
    return `{${members.join(",")}}`;
  }
  throw new Error(`cannot canonicalize a value of type ${typeof value}`);
};
