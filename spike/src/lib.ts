// Throwaway testnet helpers. Keys are read from `stellar keys` at runtime, never stored here.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  Address,
  BASE_FEE,
  hash,
  Keypair,
  Networks,
  nativeToScVal,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const PASSPHRASE = Networks.TESTNET;
export const server = new rpc.Server(RPC_URL);

const STATE_PATH = new URL("../state.json", import.meta.url);
export type State = Record<string, string | number>;
export const state = (): State => JSON.parse(readFileSync(STATE_PATH, "utf8"));
export const saveState = (patch: State) =>
  writeFileSync(STATE_PATH, `${JSON.stringify({ ...state(), ...patch }, null, 2)}\n`);

export const key = (name: string): Keypair =>
  Keypair.fromSecret(
    execFileSync("stellar", ["keys", "show", `ambit-${name}`], { encoding: "utf8" }).trim(),
  );

export const sym = (s: string) => xdr.ScVal.scvSymbol(s);
export const addr = (a: string) => new Address(a).toScVal();
export const u32 = (n: number) => xdr.ScVal.scvU32(n);
export const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
export const bytes = (b: Buffer) => xdr.ScVal.scvBytes(b);

/** ScMap with symbol keys. Soroban requires keys sorted. */
export const struct = (fields: Record<string, xdr.ScVal>) =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: sym(k), val: fields[k] as xdr.ScVal })),
  );

export const externalSigner = (verifier: string, pub: Buffer) =>
  xdr.ScVal.scvVec([sym("External"), addr(verifier), bytes(pub)]);

export type SmartSigner = {
  account: string; // smart account C-address
  kp: Keypair; // ed25519 key registered as External signer
  verifier: string;
  ruleIds: number[];
};

/** Signature payload the host passes to __check_auth. */
export const signaturePayload = (entry: xdr.SorobanAuthorizationEntry, exp: number) => {
  const creds = entry.credentials().address();
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(PASSPHRASE)),
      nonce: creds.nonce(),
      signatureExpirationLedger: exp,
      invocation: entry.rootInvocation(),
    }),
  );
  return hash(preimage.toXDR());
};

export const authDigestPreimage = (account: string, ruleIds: number[], payload: Buffer) =>
  struct({
    account: addr(account),
    context_rule_ids: xdr.ScVal.scvVec(ruleIds.map(u32)),
    signature_payload: bytes(payload),
  });

/** OpenZeppelin v0.8.0: External signers sign sha256(AuthDigestPreimage.to_xdr()). */
export const signEntry = (entry: xdr.SorobanAuthorizationEntry, s: SmartSigner, exp: number) => {
  const creds = entry.credentials().address();
  creds.signatureExpirationLedger(exp);
  const payload = signaturePayload(entry, exp);
  const digest = hash(authDigestPreimage(s.account, s.ruleIds, payload).toXDR());
  const sig = s.kp.sign(digest);
  creds.signature(
    struct({
      context_rule_ids: xdr.ScVal.scvVec(s.ruleIds.map(u32)),
      signers: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: externalSigner(s.verifier, s.kp.rawPublicKey()),
          val: bytes(sig),
        }),
      ]),
    }),
  );
  return { payload, digest };
};

export type Result = {
  ok: boolean;
  stage: "simulate-record" | "simulate-enforce" | "submit" | "done";
  error?: string;
  hash?: string;
  fee?: string;
  resourceFee?: string;
  cpuInsns?: number;
  readBytes?: number;
  writeBytes?: number;
  returnValue?: unknown;
};

const errorCode = (s: string) => s.match(/Error\((Contract|Auth|Value|WasmVm|Context|Budget|Storage|Object|Crypto|Events), #?\w+\)/g)?.join(" ") ?? s.slice(0, 600);

const buildTx = async (fee: Keypair, op: xdr.Operation) => {
  const source = await server.getAccount(fee.publicKey());
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(120)
    .build();
};

/**
 * Invoke a contract. Auth entries whose address is `signer.account` are signed with the
 * smart account format. `deployer` pays the fee and submits.
 */
export const invoke = async (opts: {
  contract: string;
  fn: string;
  args: xdr.ScVal[];
  signer?: SmartSigner;
  submit?: boolean;
}): Promise<Result> => {
  const fee = key("deployer");
  const base = { contract: opts.contract, function: opts.fn, args: opts.args };
  const tx1 = await buildTx(fee, Operation.invokeContractFunction(base));
  const sim1 = await server.simulateTransaction(tx1);
  if (rpc.Api.isSimulationError(sim1)) {
    return { ok: false, stage: "simulate-record", error: errorCode(sim1.error) };
  }
  const latest = (await server.getLatestLedger()).sequence;
  const entries = (sim1.result?.auth ?? []).map((e) => {
    const isAccount =
      e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() &&
      opts.signer &&
      Address.fromScAddress(e.credentials().address().address()).toString() ===
        opts.signer.account;
    if (isAccount && opts.signer) signEntry(e, opts.signer, latest + 60);
    return e;
  });
  const tx2 = await buildTx(fee, Operation.invokeContractFunction({ ...base, auth: entries }));
  const sim2 = await server.simulateTransaction(tx2);
  if (rpc.Api.isSimulationError(sim2)) {
    return { ok: false, stage: "simulate-enforce", error: errorCode(sim2.error) };
  }
  const res = sim2.transactionData.build().resources();
  const metrics = {
    resourceFee: sim2.minResourceFee,
    cpuInsns: res.instructions(),
    readBytes: res.diskReadBytes(),
    writeBytes: res.writeBytes(),
    returnValue: sim2.result?.retval ? safeNative(sim2.result.retval) : undefined,
  };
  if (opts.submit === false) return { ok: true, stage: "done", ...metrics };
  const tx3 = rpc.assembleTransaction(tx2, sim2).build();
  tx3.sign(fee);
  const sent = await server.sendTransaction(tx3);
  if (sent.status === "ERROR") {
    return { ok: false, stage: "submit", error: sent.errorResult?.toXDR("base64"), ...metrics };
  }
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  const ok = final.status === rpc.Api.GetTransactionStatus.SUCCESS;
  return {
    ok,
    stage: "done",
    hash: sent.hash,
    fee: tx3.fee,
    ...metrics,
    ...(ok ? {} : { error: `tx status ${final.status}` }),
  };
};

export type Prepared = { nonce: xdr.Int64; data: xdr.SorobanTransactionData; minResourceFee: string };

const recordAuth = async (contract: string, fn: string, args: xdr.ScVal[]) => {
  const sim = await server.simulateTransaction(
    await buildTx(key("deployer"), Operation.invokeContractFunction({ contract, function: fn, args })),
  );
  if (rpc.Api.isSimulationError(sim)) throw new Error(`record failed: ${errorCode(sim.error)}`);
  return sim.result?.auth ?? [];
};

const isAccountEntry = (account: string) => (e: xdr.SorobanAuthorizationEntry) =>
  e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() &&
  Address.fromScAddress(e.credentials().address().address()).toString() === account;

/** Simulate a call that passes and keep its nonce, footprint and resources. Nothing is submitted. */
export const prepare = async (contract: string, fn: string, args: xdr.ScVal[], signer: SmartSigner): Promise<Prepared> => {
  const entries = await recordAuth(contract, fn, args);
  const mine = entries.find(isAccountEntry(signer.account));
  if (!mine) throw new Error("no smart account auth entry");
  const exp = (await server.getLatestLedger()).sequence + 60;
  signEntry(mine, signer, exp);
  const sim = await server.simulateTransaction(
    await buildTx(key("deployer"), Operation.invokeContractFunction({ contract, function: fn, args, auth: entries })),
  );
  if (rpc.Api.isSimulationError(sim)) throw new Error(`prepare failed: ${errorCode(sim.error)}`);
  return { nonce: mine.credentials().address().nonce(), data: sim.transactionData.build(), minResourceFee: sim.minResourceFee };
};

/**
 * Submit a call that simulation refuses, to see the refusal on-chain. Footprint, resources and
 * nonce come from a call prepared earlier on the same path, so the only difference is the call.
 */
export const forceSubmit = async (opts: {
  contract: string;
  fn: string;
  args: xdr.ScVal[];
  prepared: Prepared;
  signer: SmartSigner;
}): Promise<Result> => {
  const fee = key("deployer");
  const exp = (await server.getLatestLedger()).sequence + 60;
  const entries = await recordAuth(opts.contract, opts.fn, opts.args);
  for (const e of entries) {
    if (!isAccountEntry(opts.signer.account)(e)) continue;
    e.credentials().address().nonce(opts.prepared.nonce);
    signEntry(e, opts.signer, exp);
  }
  const r = opts.prepared.data.resources();
  const resourceFee = BigInt(opts.prepared.minResourceFee) * 2n;
  const data = new SorobanDataBuilder(opts.prepared.data.toXDR())
    .setResources(r.instructions() * 2, r.diskReadBytes(), r.writeBytes() + 1000)
    .setResourceFee(resourceFee)
    .build();
  const source = await server.getAccount(fee.publicKey());
  const tx = new TransactionBuilder(source, { fee: (resourceFee + 1000n).toString(), networkPassphrase: PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: opts.contract, function: opts.fn, args: opts.args, auth: entries }))
    .setSorobanData(data)
    .setTimeout(120)
    .build();
  tx.sign(fee);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    return { ok: false, stage: "submit", hash: sent.hash, error: sent.errorResult?.result().switch().name };
  }
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  let error: string | undefined;
  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    const diag = (final.diagnosticEventsXdr ?? []).map((d) => {
      try {
        return JSON.stringify(scValToNative(d.event().body().v0().data()), (_, x) => (typeof x === "bigint" ? x.toString() : x));
      } catch {
        return "";
      }
    });
    const res = final.resultXdr.result().results()[0]?.tr().invokeHostFunctionResult().switch().name;
    error = `${res} ${errorCode(diag.join(" "))}`;
  }
  return { ok: final.status === rpc.Api.GetTransactionStatus.SUCCESS, stage: "done", hash: sent.hash, ...(error ? { error } : {}) };
};

import { SorobanDataBuilder, scValToNative } from "@stellar/stellar-sdk";
const safeNative = (v: xdr.ScVal) => {
  try {
    return JSON.parse(
      JSON.stringify(scValToNative(v), (_, x) =>
        typeof x === "bigint"
          ? x.toString()
          : x?.type === "Buffer" && Array.isArray(x.data)
            ? Buffer.from(x.data).toString("hex")
            : x,
      ),
    );
  } catch {
    return v.toXDR("base64");
  }
};

/** Read-only call through simulation. */
export const view = async (contract: string, fn: string, args: xdr.ScVal[] = []) =>
  (await invoke({ contract, fn, args, submit: false })).returnValue;

export const usdcBalance = async (who: string) =>
  view(state().usdcSac as string, "balance", [addr(who)]);

export const log = (label: string, r: unknown) =>
  console.log(`${label}:`, JSON.stringify(r, null, 2));
