import { Keypair } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deployAccount,
  fundWithFriendbot,
  getAccountWasmHash,
  getContextRule,
  getContextRulesCount,
} from "./account.js";
import { loadNetwork } from "./network.js";

// Every run deploys a fresh account with fresh keys. Nothing depends on a long-lived account.
const network = "testnet";
const config = loadNetwork(network);

describe("smart account deploy (testnet)", () => {
  const owner = Keypair.random();
  const source = Keypair.random();
  let account = "";

  beforeAll(async () => {
    await fundWithFriendbot(config, network, source.publicKey());
    ({ account } = await deployAccount({
      network,
      config,
      source,
      ownerPublicKey: owner.publicKey(),
    }));
  });

  it("runs the pinned account build", async () => {
    expect(await getAccountWasmHash(config, network, account)).toBe(config.accountWasmHash);
  });

  it("has only the Default rule, with the owner as its one signer", async () => {
    expect(await getContextRulesCount(config, network, account)).toBe(1);
    const rule = await getContextRule(config, network, account, 0);
    expect(rule.id).toBe(0);
    expect(rule.contextType).toEqual({ kind: "Default" });
    expect(rule.signers).toEqual([
      {
        kind: "External",
        verifier: config.verifiers.ed25519,
        keyData: owner.rawPublicKey().toString("hex"),
      },
    ]);
    expect(rule.policies).toEqual([]);
    expect(rule.validUntil).toBeNull();
  });
});
