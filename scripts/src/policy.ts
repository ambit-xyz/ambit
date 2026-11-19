import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Address,
  BASE_FEE,
  type Keypair,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { simulateView } from "./account.js";
import { addr, i128, struct, u32 } from "./auth.js";
import { type NetworkConfig, type NetworkName, required } from "./network.js";

/** Where `stellar contract build` writes the contract, from the repo root. */
export const POLICY_WASM = new URL(
  "../../target/wasm32v1-none/release/ambit_policy.wasm",
  import.meta.url,
);

export const sha256Hex = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

const send = async (
  server: rpc.Server,
  config: NetworkConfig,
  source: Keypair,
  op: xdr.Operation,
): Promise<rpc.Api.GetSuccessfulTransactionResponse & { hash: string }> => {
  const tx = new TransactionBuilder(await server.getAccount(source.publicKey()), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`rejected: ${sent.errorResult?.toXDR("base64") ?? "no result"}`);
  }
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`failed: ${final.status} (${sent.hash})`);
  }
  return { ...final, hash: sent.hash };
};

export type PolicyDeployment = {
  address: string;
  wasmHash: string;
  uploadTx: string;
  deployTx: string;
};

/**
 * Uploads the `ambit-policy` WASM and creates one new instance of it. The contract has no
 * constructor, no admin and no upgrade function, so each call is a new, independent deployment.
 */
export const deployPolicy = async (opts: {
  network: NetworkName;
  config: NetworkConfig;
  source: Keypair;
  wasm: Buffer;
}): Promise<PolicyDeployment> => {
  const server = new rpc.Server(required(opts.config.rpcUrl, "rpcUrl", opts.network));
  const wasmHash = sha256Hex(opts.wasm);

  const upload = await send(
    server,
    opts.config,
    opts.source,
    Operation.uploadContractWasm({ wasm: opts.wasm }),
  );
  const deploy = await send(
    server,
    opts.config,
    opts.source,
    Operation.createCustomContract({
      address: new Address(opts.source.publicKey()),
      wasmHash: Buffer.from(wasmHash, "hex"),
      salt: randomBytes(32),
    }),
  );
  if (!deploy.returnValue) throw new Error(`deploy returned no address (${deploy.hash})`);
  return {
    address: Address.fromScVal(deploy.returnValue).toString(),
    wasmHash,
    uploadTx: upload.hash,
    deployTx: deploy.hash,
  };
};

/** SHA-256 of the WASM a contract runs, read from the chain. */
export const getContractWasmHash = async (
  config: NetworkConfig,
  network: NetworkName,
  contract: string,
): Promise<string> => {
  const server = new rpc.Server(required(config.rpcUrl, "rpcUrl", network));
  return sha256Hex(await server.getContractWasmByContractId(contract));
};

/** `AmbitParams` as the policy's `install` expects it. */
export const ambitParams = (p: {
  mandateHash: Buffer;
  maxPerPayment: bigint;
  payees: string[];
}): xdr.ScVal =>
  struct({
    mandate_hash: xdr.ScVal.scvBytes(p.mandateHash),
    max_per_payment: i128(p.maxPerPayment),
    payees: xdr.ScVal.scvVec(p.payees.map(addr)),
  });

/** `SpendingLimitAccountParams` for the stock spending-limit policy. */
export const spendingLimitParams = (limit: bigint, periodLedgers: number): xdr.ScVal =>
  struct({ period_ledgers: u32(periodLedgers), spending_limit: i128(limit) });

export type PolicyConfig = { mandateHash: string; maxPerPayment: bigint; payees: string[] };

/** `get_config(account, rule_id)`, or null when nothing is installed. */
export const getPolicyConfig = async (
  config: NetworkConfig,
  network: NetworkName,
  policy: string,
  account: string,
  ruleId: number,
): Promise<PolicyConfig | null> => {
  const raw = scValToNative(
    await simulateView(config, network, policy, "get_config", [addr(account), u32(ruleId)]),
  ) as { mandate_hash: Uint8Array; max_per_payment: bigint; payees: string[] } | null | undefined;
  if (!raw) return null;
  return {
    mandateHash: Buffer.from(raw.mandate_hash).toString("hex"),
    maxPerPayment: raw.max_per_payment,
    payees: raw.payees,
  };
};

/** `check_payment(account, rule_id, to, amount)`: 0 if allowed, otherwise the error code. */
export const checkPayment = async (
  config: NetworkConfig,
  network: NetworkName,
  policy: string,
  account: string,
  ruleId: number,
  to: string,
  amount: bigint,
): Promise<number> =>
  scValToNative(
    await simulateView(config, network, policy, "check_payment", [
      addr(account),
      u32(ruleId),
      addr(to),
      i128(amount),
    ]),
  ) as number;

/** Reads the built WASM. Run `stellar contract build` first. */
export const readPolicyWasm = (): Buffer => readFileSync(POLICY_WASM);
