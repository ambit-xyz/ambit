// Isolate the cause of `event_not_transfer`, and send an over-limit payload to the facilitator.
// Usage: tsx src/05b-x402-isolate.ts
import type { PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as FacilitatorScheme } from "@x402/stellar/exact/facilitator";
import { Account, Operation, rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { addr, externalSigner, i128, invoke, key, log, PASSPHRASE, server, signEntry, state, sym, u32 } from "./lib.js";

const s = state();
const A = s.account as string;
const USDC = s.usdcSac as string;
const V = s.ed25519Verifier as string;
const NETWORK = "stellar:testnet" as const;
const agentKp = key("agent");
const fac = new FacilitatorScheme([createEd25519Signer(key("deployer").secret(), NETWORK)], {
  maxTransactionFeeStroops: 2_000_000,
});
const req = (amount: string): PaymentRequirements => ({
  scheme: "exact",
  network: NETWORK,
  asset: USDC,
  amount,
  payTo: s.payeeA as string,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
});

const payload = async (r: PaymentRequirements, ruleIds: number[], enforce: boolean) => {
  const build = (auth?: xdr.SorobanAuthorizationEntry[]) =>
    new TransactionBuilder(new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0"), {
      fee: "100",
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: USDC,
          function: "transfer",
          args: [addr(A), addr(r.payTo), i128(BigInt(r.amount))],
          ...(auth ? { auth } : {}),
        }),
      )
      .setTimeout(60)
      .build();
  const sim1 = await server.simulateTransaction(build());
  if (rpc.Api.isSimulationError(sim1)) throw new Error(sim1.error);
  const entries = sim1.result?.auth ?? [];
  const exp = (await server.getLatestLedger()).sequence + 12;
  for (const e of entries) signEntry(e, { account: A, kp: agentKp, verifier: V, ruleIds }, exp);
  const tx = build(entries);
  if (!enforce) return { x402Version: 2, accepted: r, payload: { transaction: tx.toXDR() } };
  const sim2 = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim2)) throw new Error(sim2.error.slice(0, 300));
  return { x402Version: 2, accepted: r, payload: { transaction: rpc.assembleTransaction(tx, sim2).build().toXDR() } };
};

// A rule with the agent signer and no policy at all.
const add = await invoke({
  contract: A,
  fn: "add_context_rule",
  args: [
    xdr.ScVal.scvVec([sym("CallContract"), addr(USDC)]),
    xdr.ScVal.scvString("spike-nopolicy"),
    u32((await server.getLatestLedger()).sequence + 720),
    xdr.ScVal.scvVec([externalSigner(V, agentKp.rawPublicKey())]),
    xdr.ScVal.scvMap([]),
  ],
  signer: { account: A, kp: key("owner"), verifier: V, ruleIds: [0] },
});
const noPolicyRule = (add.returnValue as { id: number }).id;
log("rule without policy", { ok: add.ok, id: noPolicyRule, hash: add.hash });

const r1 = req("100000");
const p1 = await payload(r1, [noPolicyRule], true);
log("stock facilitator, rule without policy: verify", await fac.verify(p1, r1));
log("stock facilitator, rule without policy: settle", await fac.settle(p1, r1));

// Over the limit: client skips its own enforcing simulation and sends the payload anyway.
const r2 = req("200000000");
const p2 = await payload(r2, [s.x402RuleId as number], false);
log("stock facilitator, over-limit payload: verify", await fac.verify(p2, r2));

// Remove the policy-less rule so it cannot be used later.
log(
  "remove rule without policy",
  await invoke({
    contract: A,
    fn: "remove_context_rule",
    args: [u32(noPolicyRule)],
    signer: { account: A, kp: key("owner"), verifier: V, ruleIds: [0] },
  }),
);
