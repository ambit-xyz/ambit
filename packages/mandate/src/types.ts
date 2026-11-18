export type Network = "testnet" | "mainnet";
export type Period = "1h" | "1d" | "7d" | "30d";

/** `ambit-mandate/0`. Field rules are in `schema.ts` and `validate.ts`. */
export type Mandate = {
  version: "ambit-mandate/0";
  id: string;
  network: Network;
  account: string;
  agent: {
    label: string;
    signer: { type: "ed25519"; publicKey: string };
  };
  asset: { code: string; contract: string };
  limits: {
    maxPerPayment: string;
    maxPerPeriod: string;
    period: Period;
  };
  payees: string[];
  validFrom?: string;
  validUntil: string;
  description: string;
};
