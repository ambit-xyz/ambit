// Compiles a mandate JSON file with `@ambit/mandate` and prints the result. Sends nothing and
// needs no key: it only shows what the owner's two install calls would contain.
//
//   pnpm compile:mandate                      # lists the fixtures
//   pnpm compile:mandate basic                # a fixture, by any unique part of its name
//   pnpm compile:mandate <mandate.json> [--network testnet]
//   pnpm compile:mandate <mandate.json> --ledger 1000000 --now 2026-11-20T00:00:00Z
//
// The mandate is a file path or the name of a fixture in `tests/fixtures/mandates/valid/` or
// Without `--ledger` and `--now`, the latest ledger and its close time are read from the network's
// RPC.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compile } from "@ambit/mandate";
import { rpc } from "@stellar/stellar-sdk";
import { isNetworkName, loadNetwork, required } from "./network.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    network: { type: "string", default: "testnet" },
    ledger: { type: "string" },
    now: { type: "string" },
  },
});

const USAGE =
  "usage: pnpm compile:mandate <fixture name | mandate.json> [--network testnet] [--ledger N --now ISO]";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES = resolve(ROOT, "tests/fixtures/mandates");

const fixtures = (): string[] =>
  (["valid", "invalid"] as const).flatMap((dir) =>
    readdirSync(resolve(FIXTURES, dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => `${dir}/${f}`),
  );

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const list = (names: string[]) => names.map((f) => `  ${f}`).join("\n");

const findMandate = (name: string): string => {
  const asPath = resolve(ROOT, name);
  if (name.endsWith(".json") && existsSync(asPath)) return asPath;
  const wanted = name.replace(/\.json$/, "");
  const all = fixtures();
  const exact = all.filter((f) => basename(f, ".json") === wanted);
  const matches = exact.length > 0 ? exact : all.filter((f) => f.includes(wanted));
  if (matches.length === 1) return resolve(FIXTURES, matches[0] as string);
  return matches.length > 0
    ? fail(`"${name}" matches more than one fixture:\n${list(matches)}`)
    : fail(`no file or fixture "${name}". Fixtures:\n${list(all)}`);
};

const [file] = positionals;
if (positionals.length > 1) fail(USAGE);
if (!file) {
  console.log(`${USAGE}\n\nFixtures in tests/fixtures/mandates/:\n${list(fixtures())}`);
  process.exit(0);
}
const network = values.network ?? "testnet";
if (!isNetworkName(network)) fail(`unknown network: ${network}`);
if ((values.ledger === undefined) !== (values.now === undefined)) {
  fail("pass --ledger and --now together, or neither to read them from the network");
}
const config = loadNetwork(network);

/** The ledger to count from and its time, given on the command line or read together from RPC. */
const startingPoint = async (): Promise<{ currentLedger: number; now: Date }> => {
  if (values.ledger !== undefined && values.now !== undefined) {
    return { currentLedger: Number(values.ledger), now: new Date(values.now) };
  }
  const server = new rpc.Server(required(config.rpcUrl, "rpcUrl", network));
  const latest = await server.getLatestLedger();
  return { currentLedger: latest.sequence, now: new Date(Number(latest.closeTime) * 1000) };
};

const path = findMandate(file);
const mandate = JSON.parse(readFileSync(path, "utf8")) as unknown;
const { currentLedger, now } = await startingPoint();

const result = compile(mandate, {
  network,
  now,
  currentLedger,
  usdcSac: required(config.usdcSac, "usdcSac", network),
  ed25519Verifier: required(config.verifiers.ed25519, "verifiers.ed25519", network),
  ambitPolicy: required(config.policies.ambitPolicy, "policies.ambitPolicy", network),
  spendingLimit: required(config.policies.spendingLimit, "policies.spendingLimit", network),
});

const printable = (_: string, value: unknown) => {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return value;
};

console.log(`mandate: ${path.slice(ROOT.length)}`);
console.log(`context: ${network}, ledger ${currentLedger} at ${now.toISOString()}`);
console.log(JSON.stringify(result, printable, 2));
if (!result.ok) process.exitCode = 1;
