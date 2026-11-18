import { createHash, randomBytes } from "node:crypto";
import {
  Account,
  Address,
  BASE_FEE,
  type Keypair,
  Operation,
  rpc,
  StrKey,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { type NetworkConfig, type NetworkName, required } from "./network.js";

/** OpenZeppelin `Signer::External(verifier, key_data)` for an ed25519 key. */
export const ed25519ExternalSigner = (verifier: string, publicKey: string): xdr.ScVal =>
  xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("External"),
    new Address(verifier).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(StrKey.decodeEd25519PublicKey(publicKey))),
  ]);

export type RuleSigner =
  | { kind: "Delegated"; address: string }
  | { kind: "External"; verifier: string; keyData: string };

export type ContextRule = {
  id: number;
  name: string;
  contextType: { kind: "Default" } | { kind: string; args: unknown[] };
  signers: RuleSigner[];
  policies: string[];
  validUntil: number | null;
};

const toHex = (value: unknown): string => Buffer.from(value as Uint8Array).toString("hex");

const decodeSigner = (raw: unknown): RuleSigner => {
  const [kind, a, b] = raw as [string, string, Uint8Array?];
  if (kind === "Delegated") return { kind, address: a };
  if (kind === "External") return { kind, verifier: a, keyData: toHex(b) };
  throw new Error(`unknown signer kind: ${kind}`);
};

/** Decodes an OpenZeppelin v0.8.0 `ContextRule` returned by `get_context_rule`. */
export const decodeContextRule = (value: xdr.ScVal): ContextRule => {
  const raw = scValToNative(value) as {
    id: number;
    name: string;
    context_type: [string, ...unknown[]];
    signers: unknown[];
    policies: string[];
    valid_until: number | null | undefined;
  };
  const [kind, ...args] = raw.context_type;
  return {
    id: raw.id,
    name: raw.name,
    contextType: kind === "Default" ? { kind } : { kind, args },
    signers: raw.signers.map(decodeSigner),
    policies: raw.policies,
    validUntil: raw.valid_until ?? null,
  };
};

const server = (net: NetworkConfig, name: NetworkName) =>
  new rpc.Server(required(net.rpcUrl, "rpcUrl", name), {
    allowHttp: false,
  });

export type DeployResult = { account: string; txHash: string };

/**
 * Deploys the stock OpenZeppelin account build with one ed25519 owner signer and no policies.
 * The constructor creates only the Default rule (id 0). `source` pays the fee and is the deployer.
 */
export const deployAccount = async (opts: {
  network: NetworkName;
  config: NetworkConfig;
  source: Keypair;
  ownerPublicKey: string;
  salt?: Buffer;
}): Promise<DeployResult> => {
  const { network, config } = opts;
  const rpcServer = server(config, network);
  const wasmHash = required(config.accountWasmHash, "accountWasmHash", network);
  const verifier = required(config.verifiers.ed25519, "verifiers.ed25519", network);

  const op = Operation.createCustomContract({
    address: new Address(opts.source.publicKey()),
    wasmHash: Buffer.from(wasmHash, "hex"),
    salt: opts.salt ?? randomBytes(32),
    constructorArgs: [
      xdr.ScVal.scvVec([ed25519ExternalSigner(verifier, opts.ownerPublicKey)]),
      xdr.ScVal.scvMap([]),
    ],
  });

  const sourceAccount = await rpcServer.getAccount(opts.source.publicKey());
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();

  const prepared = await rpcServer.prepareTransaction(tx);
  prepared.sign(opts.source);
  const sent = await rpcServer.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`deploy rejected: ${sent.errorResult?.toXDR("base64") ?? "no result"}`);
  }
  const final = await rpcServer.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`deploy failed: ${final.status} (${sent.hash})`);
  }
  if (!final.returnValue) throw new Error(`deploy returned no address (${sent.hash})`);
  return { account: Address.fromScVal(final.returnValue).toString(), txHash: sent.hash };
};

/** Read-only contract call through simulation. Nothing is signed or submitted. */
const simulateView = async (
  net: NetworkConfig,
  name: NetworkName,
  contract: string,
  fn: string,
  args: xdr.ScVal[],
): Promise<xdr.ScVal> => {
  // Simulation does not check the source account, so a placeholder with sequence 0 is enough.
  const placeholder = new Account(StrKey.encodeEd25519PublicKey(Buffer.alloc(32)), "0");
  const tx = new TransactionBuilder(placeholder, {
    fee: BASE_FEE,
    networkPassphrase: net.networkPassphrase,
  })
    .addOperation(Operation.invokeContractFunction({ contract, function: fn, args }))
    .setTimeout(30)
    .build();
  const sim = await server(net, name).simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn} failed: ${sim.error}`);
  const retval = sim.result?.retval;
  if (!retval) throw new Error(`${fn} returned nothing`);
  return retval;
};

export const getContextRule = async (
  net: NetworkConfig,
  name: NetworkName,
  account: string,
  id: number,
): Promise<ContextRule> =>
  decodeContextRule(
    await simulateView(net, name, account, "get_context_rule", [xdr.ScVal.scvU32(id)]),
  );

export const getContextRulesCount = async (
  net: NetworkConfig,
  name: NetworkName,
  account: string,
): Promise<number> =>
  scValToNative(await simulateView(net, name, account, "get_context_rules_count", [])) as number;

/** SHA-256 of the WASM the account runs, read from the chain. */
export const getAccountWasmHash = async (
  net: NetworkConfig,
  name: NetworkName,
  account: string,
): Promise<string> => {
  const wasm = await server(net, name).getContractWasmByContractId(account);
  return createHash("sha256").update(wasm).digest("hex");
};

/** Funds a testnet G-address through friendbot. */
export const fundWithFriendbot = async (net: NetworkConfig, name: NetworkName, address: string) => {
  const url = required(net.friendbotUrl, "friendbotUrl", name);
  const res = await fetch(`${url}?addr=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`friendbot failed: ${res.status} ${await res.text()}`);
};
