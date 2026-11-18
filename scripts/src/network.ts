import { readFileSync } from "node:fs";

export type NetworkName = "testnet" | "mainnet";

export type NetworkConfig = {
  networkPassphrase: string;
  rpcUrl: string | null;
  friendbotUrl: string | null;
  usdcIssuer: string | null;
  usdcSac: string | null;
  accountWasmHash: string | null;
  verifiers: { ed25519: string | null; webauthn: string | null };
  policies: { spendingLimit: string | null; ambitPolicy: string | null };
};

const CONFIG_URL = new URL("../../config/networks.json", import.meta.url);

export const isNetworkName = (value: string): value is NetworkName =>
  value === "testnet" || value === "mainnet";

export const loadNetwork = (name: NetworkName): NetworkConfig => {
  const all = JSON.parse(readFileSync(CONFIG_URL, "utf8")) as Record<NetworkName, NetworkConfig>;
  return all[name];
};

/** Returns the value, or throws if the network config has not been filled for it. */
export const required = <T>(value: T | null, field: string, network: NetworkName): T => {
  if (value === null) {
    throw new Error(`config/networks.json: ${network}.${field} is not set`);
  }
  return value;
};
