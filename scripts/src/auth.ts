// Calls into contracts that need a smart account's approval, signed the OpenZeppelin v0.8.0 way.
//
// The flow is two simulations. The first records which auth entries the call needs. The entries
// for the smart account are signed, then the second simulation runs `__check_auth` for real
// (verifier and policies included) and returns the footprint the transaction needs.
import { createHash } from "node:crypto";
import {
  Address,
  BASE_FEE,
  type Keypair,
  nativeToScVal,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { ed25519ExternalSigner } from "./account.js";
import { type NetworkConfig, type NetworkName, required } from "./network.js";

const sha256 = (data: Buffer): Buffer => createHash("sha256").update(data).digest();

export const sym = (s: string) => xdr.ScVal.scvSymbol(s);
export const addr = (a: string) => new Address(a).toScVal();
export const u32 = (n: number) => xdr.ScVal.scvU32(n);
export const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

/** A `#[contracttype]` struct: an ScMap with symbol keys, sorted as Soroban requires. */
export const struct = (fields: Record<string, xdr.ScVal>): xdr.ScVal =>
  xdr.ScVal.scvMap(
    Object.keys(fields)
      .sort()
      .map((k) => new xdr.ScMapEntry({ key: sym(k), val: fields[k] as xdr.ScVal })),
  );

/** An ed25519 key that is an External signer on `account`, used under the rules `ruleIds`. */
export type AccountSigner = {
  account: string;
  key: Keypair;
  verifier: string;
  ruleIds: number[];
};

/**
 * Signs one auth entry for a smart account. The host gives `__check_auth` a payload hash. An
 * OpenZeppelin External signer does not sign that hash directly but the hash of
 * `AuthDigestPreimage { account, context_rule_ids, signature_payload }`, which binds the
 * signature to this account and to the rules the signer chose.
 */
export const signAccountEntry = (
  entry: xdr.SorobanAuthorizationEntry,
  signer: AccountSigner,
  networkPassphrase: string,
  expirationLedger: number,
): void => {
  const creds = entry.credentials().address();
  creds.signatureExpirationLedger(expirationLedger);
  const signaturePayload = sha256(
    xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: sha256(Buffer.from(networkPassphrase)),
        nonce: creds.nonce(),
        signatureExpirationLedger: expirationLedger,
        invocation: entry.rootInvocation(),
      }),
    ).toXDR(),
  );
  const ruleIds = xdr.ScVal.scvVec(signer.ruleIds.map(u32));
  const digest = sha256(
    struct({
      account: addr(signer.account),
      context_rule_ids: ruleIds,
      signature_payload: xdr.ScVal.scvBytes(signaturePayload),
    }).toXDR(),
  );
  creds.signature(
    struct({
      context_rule_ids: ruleIds,
      signers: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: ed25519ExternalSigner(signer.verifier, signer.key.publicKey()),
          val: xdr.ScVal.scvBytes(signer.key.sign(digest)),
        }),
      ]),
    }),
  );
};

const isEntryFor = (account: string) => (e: xdr.SorobanAuthorizationEntry) =>
  e.credentials().switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() &&
  Address.fromScAddress(e.credentials().address().address()).toString() === account;

export type InvokeResult =
  | { ok: true; hash: string; returnValue: unknown }
  /**
   * `codes` are the contract error codes raised during simulation, innermost first. A refusal
   * inside `__check_auth` reaches the caller only as `Error(Auth, InvalidAction)`. The policy's
   * own code is in the diagnostic events, which is where these come from.
   */
  | { ok: false; stage: "simulate" | "submit"; error: string; codes: number[] };

/** Contract error codes carried by diagnostic events, in the order they were raised. */
export const contractErrorCodes = (events: xdr.DiagnosticEvent[]): number[] => {
  const codes: number[] = [];
  for (const d of events) {
    const body = d.event().body().v0();
    for (const v of [...body.topics(), body.data()]) {
      if (v.switch() !== xdr.ScValType.scvError()) continue;
      const err = v.error();
      if (err.switch() !== xdr.ScErrorType.sceContract()) continue;
      const code = err.contractCode();
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes;
};

const simulationFailure = (sim: rpc.Api.SimulateTransactionErrorResponse): InvokeResult => ({
  ok: false,
  stage: "simulate",
  error: sim.error,
  codes: contractErrorCodes(sim.events ?? []),
});

/**
 * Calls `contract.fn(args)` from `source`, which pays the fee. Auth entries for
 * `signer.account` are signed by `signer`. Any other entry is left as simulation returned it,
 * which works when it is the transaction source's own authorization.
 */
export const invoke = async (opts: {
  network: NetworkName;
  config: NetworkConfig;
  source: Keypair;
  contract: string;
  fn: string;
  args: xdr.ScVal[];
  signer?: AccountSigner;
}): Promise<InvokeResult> => {
  const { config } = opts;
  const server = new rpc.Server(required(config.rpcUrl, "rpcUrl", opts.network));
  const call = { contract: opts.contract, function: opts.fn, args: opts.args };
  const build = async (auth?: xdr.SorobanAuthorizationEntry[]) =>
    new TransactionBuilder(await server.getAccount(opts.source.publicKey()), {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(Operation.invokeContractFunction({ ...call, ...(auth ? { auth } : {}) }))
      .setTimeout(120)
      .build();

  const recorded = await server.simulateTransaction(await build());
  if (rpc.Api.isSimulationError(recorded)) return simulationFailure(recorded);
  const entries = recorded.result?.auth ?? [];
  if (opts.signer) {
    const expiration = (await server.getLatestLedger()).sequence + 60;
    for (const entry of entries.filter(isEntryFor(opts.signer.account))) {
      signAccountEntry(entry, opts.signer, config.networkPassphrase, expiration);
    }
  }

  const tx = await build(entries);
  const enforced = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(enforced)) return simulationFailure(enforced);
  const assembled = rpc.assembleTransaction(tx, enforced).build();
  assembled.sign(opts.source);
  const sent = await server.sendTransaction(assembled);
  if (sent.status === "ERROR") {
    const error = sent.errorResult?.toXDR("base64") ?? "rejected";
    return { ok: false, stage: "submit", error, codes: [] };
  }
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    return { ok: false, stage: "submit", error: `${final.status} (${sent.hash})`, codes: [] };
  }
  const returnValue = final.returnValue ? scValToNative(final.returnValue) : undefined;
  return { ok: true, hash: sent.hash, returnValue };
};
