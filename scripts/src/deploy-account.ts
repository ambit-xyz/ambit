// Deploys a smart account (stock OpenZeppelin build) with one ed25519 owner signer.
//
//   pnpm deploy:account --network testnet --owner G... [--source <stellar keys name>]
//
// `--owner` is the public key of the owner signer. Only the Default rule is created.
// `--source` names a `stellar keys` identity that pays the fee. On testnet, without `--source`,
// a throwaway key is created and funded by friendbot. No secret is written to disk.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { deployAccount, fundWithFriendbot, getAccountWasmHash, getContextRule } from "./account.js";
import { isNetworkName, loadNetwork } from "./network.js";

const { values } = parseArgs({
  options: {
    network: { type: "string", default: "testnet" },
    owner: { type: "string" },
    source: { type: "string" },
  },
});

const network = values.network ?? "testnet";
if (!isNetworkName(network)) throw new Error(`unknown network: ${network}`);
const owner = values.owner;
if (!owner || !StrKey.isValidEd25519PublicKey(owner)) {
  throw new Error("--owner must be an ed25519 public key (G...)");
}
const config = loadNetwork(network);

const sourceFromIdentity = (name: string): Keypair =>
  Keypair.fromSecret(execFileSync("stellar", ["keys", "show", name], { encoding: "utf8" }).trim());

let source: Keypair;
if (values.source) {
  source = sourceFromIdentity(values.source);
} else if (network === "testnet") {
  source = Keypair.random();
  await fundWithFriendbot(config, network, source.publicKey());
} else {
  throw new Error("--source is required outside testnet");
}

const { account, txHash } = await deployAccount({
  network,
  config,
  source,
  ownerPublicKey: owner,
});
const wasmHash = await getAccountWasmHash(config, network, account);
const defaultRule = await getContextRule(config, network, account, 0);

console.log(JSON.stringify({ network, account, owner, txHash, wasmHash, defaultRule }, null, 2));
