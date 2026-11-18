import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mandateHash, mandateHashBytes } from "./hash.js";
import type { Mandate } from "./types.js";

const FIXTURES = new URL("../../../tests/fixtures/mandates/", import.meta.url);
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURES), "utf8")) as unknown;

// Expected hashes were computed outside this code (Python `json.dumps(sort_keys=True,
// separators=(",", ":"), ensure_ascii=False)` + SHA-256). For mandates, which hold only objects,
// arrays and strings, that output is the same as RFC 8785.
const vectors = read("hash-vectors.json") as { fixture: string; sha256: string }[];
const basic = read("valid/basic.json") as Mandate;

/** Deep copy with every object's keys in reverse order. */
const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  }
  return value;
};

/** Every string leaf as a path, for example ["limits", "maxPerPayment"] or ["payees", 0]. */
const leafPaths = (value: unknown, path: (string | number)[] = []): (string | number)[][] => {
  if (typeof value === "string") return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => leafPaths(v, [...path, i]));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...path, k]));
  }
  return [];
};

const withLeaf = (mandate: Mandate, path: (string | number)[], next: string): Mandate => {
  const copy = structuredClone(mandate) as unknown as Record<string | number, unknown>;
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path.at(-1) as string | number] = next;
  return copy as unknown as Mandate;
};

describe("mandateHash", () => {
  it("has one vector per valid fixture", () => {
    expect(vectors.length).toBeGreaterThan(0);
  });

  it.each(vectors)("$fixture → $sha256", ({ fixture, sha256 }) => {
    expect(mandateHash(read(fixture) as Mandate)).toBe(sha256);
  });

  it("returns 32 bytes that match the hex form", () => {
    const bytes = mandateHashBytes(basic);
    expect(bytes).toHaveLength(32);
    expect(Buffer.from(bytes).toString("hex")).toBe(mandateHash(basic));
  });

  it("does not depend on key order or whitespace", () => {
    const text = readFileSync(new URL("valid/basic.json", FIXTURES), "utf8");
    const reordered = reverseKeys(JSON.parse(text)) as Mandate;
    const reformatted = JSON.parse(JSON.stringify(reordered, null, 7)) as Mandate;
    const minified = JSON.parse(text.replace(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "")) as Mandate;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(basic));
    expect(mandateHash(reordered)).toBe(mandateHash(basic));
    expect(mandateHash(reformatted)).toBe(mandateHash(basic));
    expect(mandateHash(minified)).toBe(mandateHash(basic));
  });

  it.each(leafPaths(basic).map((path) => [path.join("."), path] as const))(
    "changes when %s changes",
    (_, path) => {
      expect(mandateHash(withLeaf(basic, path, "changed"))).not.toBe(mandateHash(basic));
    },
  );

  it("changes when an optional field is removed or payees are reordered", () => {
    const { validFrom: _, ...withoutValidFrom } = basic;
    const reordered = { ...basic, payees: [...basic.payees].reverse() };
    expect(mandateHash(withoutValidFrom)).not.toBe(mandateHash(basic));
    expect(mandateHash(reordered)).not.toBe(mandateHash(basic));
  });
});
