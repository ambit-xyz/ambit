// Re-run two checks with correct arguments, and read error codes of failed on-chain txs.
// Usage: tsx src/03b-recheck.ts <failedTxHash>...
import { rpc, xdr } from "@stellar/stellar-sdk";
import { addr, i128, invoke, key, log, server, state, sym, u32 } from "./lib.js";

const s = state();
const A = s.account as string;
const USDC = s.usdcSac as string;
const V = s.ed25519Verifier as string;
const rule = s.mandateRuleId as number;
const agentKp = key("agent");
const agent = { account: A, kp: agentKp, verifier: V, ruleIds: [rule] };

const errorsIn = (v: xdr.ScVal, out: string[]) => {
  switch (v.switch()) {
    case xdr.ScValType.scvError(): {
      const e = v.error();
      out.push(
        e.switch() === xdr.ScErrorType.sceContract()
          ? `Error(Contract, #${e.contractCode()})`
          : `Error(${e.switch().name}, ${e.code().name})`,
      );
      break;
    }
    case xdr.ScValType.scvVec():
      for (const x of v.vec() ?? []) errorsIn(x, out);
      break;
  }
};

for (const h of process.argv.slice(2)) {
  const tx = await server.getTransaction(h);
  const out: string[] = [];
  if (tx.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
    for (const d of tx.diagnosticEventsXdr ?? []) {
      const body = d.event().body().v0();
      for (const t of body.topics()) errorsIn(t, out);
      errorsIn(body.data(), out);
    }
  }
  log(`tx ${h}`, { status: tx.status, errors: [...new Set(out)] });
}

log(
  "agent calls execute(USDC.transfer to payee-a) on the account",
  await invoke({
    contract: A,
    fn: "execute",
    args: [
      addr(USDC),
      sym("transfer"),
      xdr.ScVal.scvVec([addr(A), addr(s.payeeA as string), i128(1n)]),
    ],
    signer: agent,
    submit: false,
  }),
);

const ruleScVal = xdr.ScVal.scvMap(
  [
    ["context_type", xdr.ScVal.scvVec([sym("CallContract"), addr(USDC)])],
    ["id", u32(rule)],
    ["name", xdr.ScVal.scvString("ambit:spike001")],
    ["policies", xdr.ScVal.scvVec([addr(s.spendingLimit as string)])],
    ["policy_ids", xdr.ScVal.scvVec([u32(0)])],
    ["signer_ids", xdr.ScVal.scvVec([u32(1)])],
    [
      "signers",
      xdr.ScVal.scvVec([
        xdr.ScVal.scvVec([sym("External"), addr(V), xdr.ScVal.scvBytes(agentKp.rawPublicKey())]),
      ]),
    ],
    ["valid_until", u32(s.mandateRuleIdValidUntil as number)],
  ].map(([k, v]) => new xdr.ScMapEntry({ key: sym(k as string), val: v as xdr.ScVal })),
);
log(
  "agent raises its own spending limit (set_spending_limit with the real rule)",
  await invoke({
    contract: s.spendingLimit as string,
    fn: "set_spending_limit",
    args: [i128(10_000_000_000n), ruleScVal, addr(A)],
    signer: agent,
    submit: false,
  }),
);
log(
  "same call signed by the owner on the Default rule (control)",
  await invoke({
    contract: s.spendingLimit as string,
    fn: "set_spending_limit",
    args: [i128(100_000_000n), ruleScVal, addr(A)],
    signer: { ...agent, kp: key("owner"), ruleIds: [0] },
    submit: false,
  }),
);
