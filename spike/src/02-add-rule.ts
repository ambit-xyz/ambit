// Owner adds a mandate-like rule: CallContract(USDC SAC), agent External signer, spending limit.
// Usage: tsx src/02-add-rule.ts <name> <validForLedgers> <limitStroops> <periodLedgers> [stateKey]
import {
  addr,
  bytes,
  externalSigner,
  i128,
  invoke,
  key,
  log,
  saveState,
  server,
  state,
  struct,
  sym,
  u32,
} from "./lib.js";
import { xdr } from "@stellar/stellar-sdk";

const [name = "ambit:spike001", validFor = "1440", limit = "100000000", period = "720", stateKey = "mandateRuleId"] =
  process.argv.slice(2);
const s = state();
const owner = key("owner");
const agent = key("agent");
const latest = (await server.getLatestLedger()).sequence;
const validUntil = latest + Number(validFor);

const r = await invoke({
  contract: s.account as string,
  fn: "add_context_rule",
  args: [
    xdr.ScVal.scvVec([sym("CallContract"), addr(s.usdcSac as string)]),
    xdr.ScVal.scvString(name),
    u32(validUntil),
    xdr.ScVal.scvVec([externalSigner(s.ed25519Verifier as string, agent.rawPublicKey())]),
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: addr(s.spendingLimit as string),
        val: struct({ period_ledgers: u32(Number(period)), spending_limit: i128(BigInt(limit)) }),
      }),
    ]),
  ],
  signer: { account: s.account as string, kp: owner, verifier: s.ed25519Verifier as string, ruleIds: [0] },
});
log("add_context_rule", { latest, validUntil, ...r });
if (r.ok) {
  const rule = r.returnValue as { id: number };
  saveState({ [stateKey]: rule.id, [`${stateKey}ValidUntil`]: validUntil });
}
void bytes;
