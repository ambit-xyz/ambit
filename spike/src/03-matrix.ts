// Agent-signed calls against the mandate rule, positive and negative.
// Usage: tsx src/03-matrix.ts
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { xdr } from "@stellar/stellar-sdk";
import {
  addr,
  forceSubmit,
  prepare,
  i128,
  invoke,
  key,
  type Result,
  type SmartSigner,
  state,
  struct,
  sym,
  u32,
  usdcBalance,
  view,
} from "./lib.js";

const s = state();
const A = s.account as string;
const USDC = s.usdcSac as string;
const V = s.ed25519Verifier as string;
const rule = s.mandateRuleId as number;
const agent: SmartSigner = { account: A, kp: key("agent"), verifier: V, ruleIds: [rule] };
const usdc = (n: number) => BigInt(Math.round(n * 1e7));
const xfer = (to: string, amount: bigint) => [addr(A), addr(to), i128(amount)];
const spend = () => view(s.spendingLimit as string, "get_spending_limit_data", [u32(rule), addr(A)]);

const results: Array<{ check: string; expect: string; balanceBefore?: unknown; balanceAfter?: unknown } & Result> = [];
const run = async (check: string, expect: "pass" | "fail", fn: () => Promise<Result>) => {
  const before = await usdcBalance(A);
  let r: Result;
  try {
    r = await fn();
  } catch (e) {
    r = { ok: false, stage: "simulate-record", error: String(e) };
  }
  const after = await usdcBalance(A);
  const row = { check, expect, balanceBefore: before, balanceAfter: after, ...r };
  results.push(row);
  const verdict = (expect === "pass") === r.ok ? "AS EXPECTED" : "UNEXPECTED";
  console.log(`[${verdict}] ${check}: ok=${r.ok} stage=${r.stage} ${r.error ?? ""} ${r.hash ?? ""} balance ${before} -> ${after}`);
};

console.log("spend at start", JSON.stringify(await spend()));

await run("agent transfer 1 USDC to payee-a", "pass", () =>
  invoke({ contract: USDC, fn: "transfer", args: xfer(s.payeeA as string, usdc(1)), signer: agent }),
);
await run("transfer signed by payee-b (not a signer)", "fail", () =>
  invoke({
    contract: USDC,
    fn: "transfer",
    args: xfer(s.payeeA as string, usdc(1)),
    signer: { ...agent, kp: key("payee-b") },
  }),
);
await run("agent signs with owner rule id (wrong context_rule_ids)", "fail", () =>
  invoke({
    contract: USDC,
    fn: "transfer",
    args: xfer(s.payeeA as string, usdc(1)),
    signer: { ...agent, ruleIds: [0] },
  }),
);
await run("agent adds a context rule on the account", "fail", () =>
  invoke({
    contract: A,
    fn: "add_context_rule",
    args: [
      xdr.ScVal.scvVec([sym("Default")]),
      xdr.ScVal.scvString("agent-escape"),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvVec([xdr.ScVal.scvVec([sym("External"), addr(V), xdr.ScVal.scvBytes(agent.kp.rawPublicKey())])]),
      xdr.ScVal.scvMap([]),
    ],
    signer: agent,
  }),
);
await run("agent calls upgrade on the account", "fail", () =>
  invoke({
    contract: A,
    fn: "upgrade",
    args: [xdr.ScVal.scvBytes(Buffer.from(s.accountWasmHash as string, "hex")), addr(s.agent as string)],
    signer: agent,
  }),
);
await run("agent calls execute on the account", "fail", () =>
  invoke({
    contract: A,
    fn: "execute",
    args: [addr(USDC), sym("transfer"), xdr.ScVal.scvVec(xfer(s.agent as string, usdc(1)))],
    signer: agent,
  }),
);
await run("agent raises its own spending limit", "fail", () =>
  invoke({
    contract: s.spendingLimit as string,
    fn: "set_spending_limit",
    args: [i128(usdc(1000)), xdr.ScVal.scvVoid(), addr(A)],
    signer: agent,
  }),
);
await run("agent approves an allowance on USDC", "fail", () =>
  invoke({
    contract: USDC,
    fn: "approve",
    args: [addr(A), addr(s.agent as string), i128(usdc(5)), u32(5_700_000)],
    signer: agent,
  }),
);
await run("agent transfers 1 USDC to an arbitrary address (no allow-list yet)", "pass", () =>
  invoke({ contract: USDC, fn: "transfer", args: xfer(s.payeeB as string, usdc(1)), signer: agent }),
);
console.log("spend now", JSON.stringify(await spend()));
// Capture footprints of a passing agent transfer before the period is full.
const prepOver = await prepare(USDC, "transfer", xfer(s.payeeA as string, 1n), agent);
const prepWrongSigner = await prepare(USDC, "transfer", xfer(s.payeeA as string, 1n), agent);
await run("agent transfers 8 USDC (period total reaches the 10 USDC limit)", "pass", () =>
  invoke({ contract: USDC, fn: "transfer", args: xfer(s.payeeA as string, usdc(8)), signer: agent }),
);
await run("one stroop over the period limit (simulation)", "fail", () =>
  invoke({ contract: USDC, fn: "transfer", args: xfer(s.payeeA as string, 1n), signer: agent }),
);
await run("one stroop over the period limit (forced on-chain)", "fail", () =>
  forceSubmit({
    contract: USDC,
    fn: "transfer",
    args: xfer(s.payeeA as string, 1n),
    prepared: prepOver,
    signer: agent,
  }),
);
await run("transfer signed by payee-b (forced on-chain)", "fail", () =>
  forceSubmit({
    contract: USDC,
    fn: "transfer",
    args: xfer(s.payeeA as string, 1n),
    prepared: prepWrongSigner,
    signer: { ...agent, kp: key("payee-b") },
  }),
);
await run("owner adds rule with a 21-byte name (simulation)", "fail", () =>
  invoke({
    contract: A,
    fn: "add_context_rule",
    args: [
      xdr.ScVal.scvVec([sym("CallContract"), addr(USDC)]),
      xdr.ScVal.scvString("ambit:0123456789abcde"),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvVec([xdr.ScVal.scvVec([sym("External"), addr(V), xdr.ScVal.scvBytes(agent.kp.rawPublicKey())])]),
      xdr.ScVal.scvMap([]),
    ],
    signer: { ...agent, kp: key("owner"), ruleIds: [0] },
    submit: false,
  }),
);
console.log("spend before refund", JSON.stringify(await spend()));
await run("payee-a sends 1 USDC back into the account", "pass", async () => {
  const out = execFileSync(
    "stellar",
    ["contract", "invoke", "--id", USDC, "--source", "ambit-payee-a", "--network", "testnet", "--",
     "transfer", "--from", s.payeeA as string, "--to", A, "--amount", "10000000"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { ok: true, stage: "done", returnValue: out.trim() };
});
console.log("spend after refund", JSON.stringify(await spend()));

mkdirSync(new URL("../results", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../results/03-matrix-${Date.now()}.json`, import.meta.url),
  `${JSON.stringify({ spendEnd: await spend(), results }, null, 2)}\n`,
);
void struct;
