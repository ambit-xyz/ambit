// x402 `exact` on Stellar at the scheme level, with the stock @x402/stellar classes.
// Client and facilitator run locally. The facilitator key is `deployer`.
// Usage: tsx src/05-x402-scheme.ts
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme as ClientScheme } from "@x402/stellar/exact/client";
import { ExactStellarScheme as FacilitatorScheme } from "@x402/stellar/exact/facilitator";
import { Address, hash, Keypair, Operation, rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { addr, i128, key, log, PASSPHRASE, server, signEntry, state, usdcBalance } from "./lib.js";

const s = state();
const A = s.account as string;
const USDC = s.usdcSac as string;
const V = s.ed25519Verifier as string;
const NETWORK = "stellar:testnet" as const;
const agentSigner = { account: A, kp: key("agent"), verifier: V, ruleIds: [s.x402RuleId as number] };

const requirements = (amount: string): PaymentRequirements => ({
  scheme: "exact",
  network: NETWORK,
  asset: USDC,
  amount,
  payTo: s.payeeA as string,
  maxTimeoutSeconds: 60,
  extra: { areFeesSponsored: true },
});
const wrap = (req: PaymentRequirements, payload: Record<string, unknown>): PaymentPayload => ({
  x402Version: 2,
  accepted: req,
  payload,
});
const facilitatorSigner = createEd25519Signer(key("deployer").secret(), NETWORK);

/** Stock facilitator, optionally with a raised fee ceiling. */
const stockFacilitator = (maxTransactionFeeStroops?: number) =>
  new FacilitatorScheme([facilitatorSigner], maxTransactionFeeStroops ? { maxTransactionFeeStroops } : {});

/**
 * Patched facilitator: same checks, but contract events from contracts other than the asset
 * (for example a policy run inside the payer's __check_auth) are ignored. The single transfer
 * event of the asset is still required and still checked.
 */
class PatchedFacilitator extends FacilitatorScheme {
  override validateSimulationEvents(
    events: xdr.DiagnosticEvent[],
    from: string,
    to: string,
    amount: bigint,
    asset: string,
  ) {
    const kept = events.filter((d) => {
      const e = d.event();
      if (e.type().name !== "contract") return true;
      const id = e.contractId();
      return id ? Address.fromScAddress(xdr.ScAddress.scAddressTypeContract(id)).toString() === asset : true;
    });
    // @ts-expect-error private in the type definition, public at runtime
    return super.validateSimulationEvents(kept, from, to, amount, asset);
  }
}

/** Client payload for a smart account payer: same shape as the stock client, OZ signature format. */
const smartAccountPayload = async (req: PaymentRequirements) => {
  const nullAccount = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const op = (auth?: xdr.SorobanAuthorizationEntry[]) =>
    Operation.invokeContractFunction({
      contract: req.asset,
      function: "transfer",
      args: [addr(A), addr(req.payTo), i128(BigInt(req.amount))],
      ...(auth ? { auth } : {}),
    });
  const build = (o: xdr.Operation) =>
    new TransactionBuilder(new (await_account())(nullAccount, "0"), { fee: "100", networkPassphrase: PASSPHRASE })
      .addOperation(o)
      .setTimeout(req.maxTimeoutSeconds)
      .build();
  const sim1 = await server.simulateTransaction(build(op()));
  if (rpc.Api.isSimulationError(sim1)) throw new Error(`record: ${sim1.error}`);
  const entries = sim1.result?.auth ?? [];
  const latest = (await server.getLatestLedger()).sequence;
  const maxLedger = latest + Math.ceil(req.maxTimeoutSeconds / 5);
  for (const e of entries) signEntry(e, agentSigner, maxLedger);
  const tx2 = build(op(entries));
  const sim2 = await server.simulateTransaction(tx2);
  if (rpc.Api.isSimulationError(sim2)) throw new Error(`enforce: ${sim2.error.slice(0, 400)}`);
  return { transaction: rpc.assembleTransaction(tx2, sim2).build().toXDR() };
};
import { Account } from "@stellar/stellar-sdk";
const await_account = () => Account;

const step = async (label: string, fn: () => Promise<unknown>) => {
  try {
    log(label, await fn());
  } catch (e) {
    log(label, { threw: String(e).slice(0, 600) });
  }
};

// 5.2 Baseline: G-address payer (payee-b) with the stock client and stock facilitator.
await step("5.2 baseline G payer, stock client + stock facilitator", async () => {
  const req = requirements("100000"); // 0.01 USDC
  const client = new ClientScheme(createEd25519Signer(key("payee-b").secret(), NETWORK));
  const p = await client.createPaymentPayload(2, req);
  const tx = TransactionBuilder.fromXDR((p.payload as { transaction: string }).transaction, PASSPHRASE);
  const f = stockFacilitator();
  const payload = wrap(req, p.payload);
  const v = await f.verify(payload, req);
  const st = v.isValid ? await f.settle(payload, req) : undefined;
  return {
    payloadKeys: Object.keys(p.payload),
    txSource: tx.source,
    authEntries: (tx as any).operations[0].auth.length,
    verify: v,
    settle: st,
  };
});

// 5.3a Stock client with the smart account as payer. The signer signs the preimage with the agent key.
await step("5.3a smart account payer, stock client", async () => {
  const agentKp = key("agent");
  const client = new ClientScheme({
    address: A,
    signAuthEntry: async (preimageXdr: string) => ({
      signedAuthEntry: agentKp.sign(hash(Buffer.from(preimageXdr, "base64"))).toString("base64"),
      signerAddress: A,
    }),
  });
  return client.createPaymentPayload(2, requirements("100000"));
});

// 5.3b Custom client payload (OZ v0.8.0 signature format), stock facilitator, default fee ceiling.
const req = requirements("100000");
const payload = wrap(req, await smartAccountPayload(req));
const tx = TransactionBuilder.fromXDR((payload.payload as { transaction: string }).transaction, PASSPHRASE) as any;
log("5.3b payload", { fee: tx.fee, source: tx.source, auth: tx.operations[0].auth.length });
await step("5.3b stock facilitator, default fee ceiling: verify", () => stockFacilitator().verify(payload, req));
await step("5.3c stock facilitator, fee ceiling 2,000,000: verify", () => stockFacilitator(2_000_000).verify(payload, req));

// 5.3d Patched facilitator (ignore non-asset events), raised ceiling: verify and settle.
const before = await usdcBalance(A);
await step("5.3d patched facilitator: verify", () => new PatchedFacilitator([facilitatorSigner], { maxTransactionFeeStroops: 2_000_000 }).verify(payload, req));
await step("5.3d patched facilitator: settle", () => new PatchedFacilitator([facilitatorSigner], { maxTransactionFeeStroops: 2_000_000 }).settle(payload, req));
log("balance", { before, after: await usdcBalance(A) });

// 5.3e Negative: above the remaining period limit.
await step("5.3e above spending limit: client payload", async () => {
  const big = requirements("200000000"); // 20 USDC, limit is 10
  const p = wrap(big, await smartAccountPayload(big));
  return new PatchedFacilitator([facilitatorSigner], { maxTransactionFeeStroops: 2_000_000 }).verify(p, big);
});
void Keypair;
