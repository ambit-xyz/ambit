// Deploys a new instance of `ambit-policy` from the WASM built in this repo.
//
//   stellar contract build
//   pnpm deploy:policy --network testnet [--source <stellar keys name>] [--write]
//
// Every run is a new deployment with a new address. The contract cannot be upgraded, so a new
// version always means a new address, and existing mandates keep the address they were made with.
// `--write` records the address and WASM hash in `config/networks.json`. If an address is already
// recorded, `--replace` is needed as well.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Keypair } from "@stellar/stellar-sdk";
import { fundWithFriendbot } from "./account.js";
import { CONFIG_URL, isNetworkName, loadNetwork } from "./network.js";
import { deployPolicy, getContractWasmHash, readPolicyWasm } from "./policy.js";

const { values } = parseArgs({
  options: {
    network: { type: "string", default: "testnet" },
    source: { type: "string" },
    write: { type: "boolean", default: false },
    replace: { type: "boolean", default: false },
  },
});

const network = values.network ?? "testnet";
if (!isNetworkName(network)) throw new Error(`unknown network: ${network}`);
const config = loadNetwork(network);
const previous = config.policies.ambitPolicy;
if (values.write && previous && !values.replace) {
  throw new Error(
    `${network}.policies.ambitPolicy is already ${previous}. Pass --replace to record a new one.`,
  );
}

let source: Keypair;
if (values.source) {
  const secret = execFileSync("stellar", ["keys", "show", values.source], { encoding: "utf8" });
  source = Keypair.fromSecret(secret.trim());
} else if (network === "testnet") {
  source = Keypair.random();
  await fundWithFriendbot(config, network, source.publicKey());
} else {
  throw new Error("--source is required outside testnet");
}

const deployment = await deployPolicy({ network, config, source, wasm: readPolicyWasm() });
const onChain = await getContractWasmHash(config, network, deployment.address);
if (onChain !== deployment.wasmHash) {
  throw new Error(`on-chain WASM hash ${onChain} does not match ${deployment.wasmHash}`);
}

/** Sets `"field": value` in the given network's block only, keeping the file's layout. */
const setField = (text: string, field: string, value: string): string => {
  const start = text.indexOf(`"${network}": {`);
  const pattern = new RegExp(`("${field}":\\s*)(null|"[^"]*")`);
  const match = pattern.exec(text.slice(start));
  if (start < 0 || !match) throw new Error(`${network}.${field} not found in networks.json`);
  const at = start + match.index;
  return `${text.slice(0, at)}${match[1]}"${value}"${text.slice(at + match[0].length)}`;
};

if (values.write) {
  let text = readFileSync(CONFIG_URL, "utf8");
  text = setField(text, "ambitPolicyWasmHash", deployment.wasmHash);
  text = setField(text, "ambitPolicy", deployment.address);
  writeFileSync(CONFIG_URL, text);
  if (loadNetwork(network).policies.ambitPolicy !== deployment.address) {
    throw new Error("networks.json was not updated as expected");
  }
}

console.log(JSON.stringify({ network, ...deployment, previous, written: values.write }, null, 2));
