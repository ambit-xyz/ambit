import {
  Asset,
  Keypair,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { deployAccount, fundWithFriendbot, getContextRule, simulateView } from "./account.js";
import { type AccountSigner, addr, i128, invoke, sym, u32 } from "./auth.js";
import { loadNetwork, required } from "./network.js";
import {
  ambitParams,
  checkPayment,
  getContractWasmHash,
  getPolicyConfig,
  spendingLimitParams,
} from "./policy.js";

// The `ambit-policy` deployment recorded in config/networks.json, installed on a fresh stock
// account next to the stock spending limit, then used for real payments.
//
// The asset is a token this test issues itself, so the run needs no USDC. The policy only checks
// that the call targets the rule's asset contract, whichever asset that is.
const network = "testnet";
const config = loadNetwork(network);
const policy = required(config.policies.ambitPolicy, "policies.ambitPolicy", network);
const spendingLimit = required(config.policies.spendingLimit, "policies.spendingLimit", network);
const verifier = required(config.verifiers.ed25519, "verifiers.ed25519", network);
const server = new rpc.Server(required(config.rpcUrl, "rpcUrl", network));

const UNIT = 10_000_000n;
const CAP = 10n * UNIT;
const PERIOD_CAP = 25n * UNIT;
const PERIOD = 720;

describe("ambit-policy on testnet", () => {
  const source = Keypair.random();
  const owner = Keypair.random();
  const agent = Keypair.random();
  const payeeKey = Keypair.random();
  const strangerKey = Keypair.random();
  const payee = payeeKey.publicKey();
  const stranger = strangerKey.publicKey();
  let account = "";
  let token = "";
  let ruleId = -1;

  const run = (contract: string, fn: string, args: xdr.ScVal[], signer?: AccountSigner) =>
    invoke({ network, config, source, contract, fn, args, ...(signer ? { signer } : {}) });
  const asOwner = (): AccountSigner => ({ account, key: owner, verifier, ruleIds: [0] });
  const asAgent = (): AccountSigner => ({ account, key: agent, verifier, ruleIds: [ruleId] });
  const withoutKey = (): AccountSigner => ({ account, verifier, ruleIds: [ruleId] });
  const pay = (to: string, amount: bigint) =>
    run(token, "transfer", [addr(account), addr(to), i128(amount)], asAgent());
  const balance = async (who: string) =>
    scValToNative(await simulateView(config, network, token, "balance", [addr(who)])) as bigint;

  beforeAll(async () => {
    await fundWithFriendbot(config, network, source.publicKey());
    ({ account } = await deployAccount({
      network,
      config,
      source,
      ownerPublicKey: owner.publicKey(),
    }));

    // A token issued by `source`, with 100 units minted to the account.
    const asset = new Asset("AMBT", source.publicKey());
    token = asset.contractId(config.networkPassphrase);
    const create = await server.prepareTransaction(
      new TransactionBuilder(await server.getAccount(source.publicKey()), {
        fee: "100",
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(Operation.createStellarAssetContract({ asset }))
        .setTimeout(120)
        .build(),
    );
    create.sign(source);
    const sent = await server.sendTransaction(create);
    await server.pollTransaction(sent.hash, { attempts: 30 });
    const minted = await run(token, "mint", [addr(account), i128(100n * UNIT)]);
    expect(minted.ok).toBe(true);

    // A G-address needs a trustline to receive a classic asset. Without one the token itself
    // refuses the transfer, before the account is asked to authorize anything.
    for (const holder of [payeeKey, strangerKey]) {
      await fundWithFriendbot(config, network, holder.publicKey());
      const trust = new TransactionBuilder(await server.getAccount(holder.publicKey()), {
        fee: "100",
        networkPassphrase: config.networkPassphrase,
      })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(120)
        .build();
      trust.sign(holder);
      const sentTrust = await server.sendTransaction(trust);
      await server.pollTransaction(sentTrust.hash, { attempts: 30 });
    }

    // The owner adds the mandate rule with ambit-policy, then the spending limit after it.
    const validUntil = (await server.getLatestLedger()).sequence + 2 * PERIOD;
    const added = await run(
      account,
      "add_context_rule",
      [
        xdr.ScVal.scvVec([sym("CallContract"), addr(token)]),
        xdr.ScVal.scvString("ambit:testnet"),
        u32(validUntil),
        xdr.ScVal.scvVec([
          xdr.ScVal.scvVec([
            sym("External"),
            addr(verifier),
            xdr.ScVal.scvBytes(agent.rawPublicKey()),
          ]),
        ]),
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: addr(policy),
            val: ambitParams({
              mandateHash: Buffer.alloc(32, 7),
              maxPerPayment: CAP,
              payees: [payee],
            }),
          }),
        ]),
      ],
      asOwner(),
    );
    if (!added.ok) throw new Error(`add_context_rule: ${added.error}`);
    ruleId = (added.returnValue as { id: number }).id;

    const limited = await run(
      account,
      "add_policy",
      [u32(ruleId), addr(spendingLimit), spendingLimitParams(PERIOD_CAP, PERIOD)],
      asOwner(),
    );
    if (!limited.ok) throw new Error(`add_policy: ${limited.error}`);
  });

  it("runs the WASM hash recorded in the config", async () => {
    expect(await getContractWasmHash(config, network, policy)).toBe(config.ambitPolicyWasmHash);
  });

  it("is installed on the rule before the spending limit", async () => {
    const rule = await getContextRule(config, network, account, ruleId);
    expect(rule.policies).toEqual([policy, spendingLimit]);
    const installed = await getPolicyConfig(config, network, policy, account, ruleId);
    expect(installed).toEqual({
      mandateHash: "07".repeat(32),
      maxPerPayment: CAP,
      payees: [payee],
    });
  });

  it("answers check_payment", async () => {
    const check = (to: string, amount: bigint) =>
      checkPayment(config, network, policy, account, ruleId, to, amount);
    expect(await check(payee, CAP)).toBe(0);
    expect(await check(stranger, 1n)).toBe(9006);
    expect(await check(payee, CAP + 1n)).toBe(9008);
  });

  it("lets a payment inside the mandate through", async () => {
    const paid = await pay(payee, CAP);
    expect(paid.ok).toBe(true);
    expect(await balance(payee)).toBe(CAP);
  });

  it("refuses a payee outside the list, with the Ambit code in the simulation events", async () => {
    const paid = await pay(stranger, 1n);
    expect(paid.ok).toBe(false);
    if (paid.ok) return;
    expect(paid.codes).toContain(9006);
  });

  it("refuses a payment no signer signed, with the Ambit code first", async () => {
    const paid = await run(token, "transfer", [addr(account), addr(payee), i128(1n)], withoutKey());
    expect(paid.ok).toBe(false);
    if (paid.ok) return;
    expect(paid.codes).toContain(9011);
    // ambit-policy runs first, so the spending limit (3223 for the same reason) never runs.
    expect(paid.codes).not.toContain(3223);
  });

  it("refuses an amount above the cap per payment", async () => {
    const paid = await pay(payee, CAP + 1n);
    expect(paid.ok).toBe(false);
    if (paid.ok) return;
    expect(paid.codes).toContain(9008);
  });

  it("refuses approve", async () => {
    const approved = await run(
      token,
      "approve",
      [
        addr(account),
        addr(stranger),
        i128(CAP),
        u32((await server.getLatestLedger()).sequence + 100),
      ],
      asAgent(),
    );
    expect(approved.ok).toBe(false);
    if (approved.ok) return;
    expect(approved.codes).toContain(9003);
  });
});
