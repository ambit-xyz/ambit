// Expiry: a short-lived rule stops working after valid_until. Revoke: owner removes a rule.
// Usage: tsx src/04-expiry-revoke.ts
import { execFileSync } from "node:child_process";
import { addr, i128, invoke, key, log, server, state, u32 } from "./lib.js";

const s = state();
const A = s.account as string;
const USDC = s.usdcSac as string;
const V = s.ed25519Verifier as string;
const owner = { account: A, kp: key("owner"), verifier: V, ruleIds: [0] };
const xfer = (n: bigint) => [addr(A), addr(s.payeeA as string), i128(n)];

const addRule = (name: string, validFor: number, stateKey: string) =>
  execFileSync("npx", ["tsx", "src/02-add-rule.ts", name, String(validFor), "50000000", "720", stateKey], {
    encoding: "utf8",
  });

// Expiry
addRule("ambit:spike-exp", 12, "expRuleId");
const exp = state();
const expRule = exp.expRuleId as number;
const expUntil = exp.expRuleIdValidUntil as number;
const agentExp = { account: A, kp: key("agent"), verifier: V, ruleIds: [expRule] };
log("expiry rule", { expRule, expUntil, now: (await server.getLatestLedger()).sequence });
log("transfer before valid_until", await invoke({ contract: USDC, fn: "transfer", args: xfer(1n), signer: agentExp }));
while ((await server.getLatestLedger()).sequence <= expUntil + 1) {
  await new Promise((r) => setTimeout(r, 5000));
}
log("transfer after valid_until", {
  now: (await server.getLatestLedger()).sequence,
  ...(await invoke({ contract: USDC, fn: "transfer", args: xfer(1n), signer: agentExp, submit: false })),
});

// Revoke
addRule("ambit:spike-rev", 1440, "revRuleId");
const revRule = state().revRuleId as number;
const agentRev = { account: A, kp: key("agent"), verifier: V, ruleIds: [revRule] };
log("transfer before revoke", await invoke({ contract: USDC, fn: "transfer", args: xfer(1n), signer: agentRev }));
log("owner removes the rule", await invoke({ contract: A, fn: "remove_context_rule", args: [u32(revRule)], signer: owner }));
log("transfer after revoke", await invoke({ contract: USDC, fn: "transfer", args: xfer(1n), signer: agentRev, submit: false }));
log("rules count", await invoke({ contract: A, fn: "get_context_rules_count", args: [], submit: false }));
