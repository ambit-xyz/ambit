# Spike

Throwaway testnet experiments: an OpenZeppelin smart account paying USDC and x402 requests.
Not part of the workspace, not built by CI, not production code.

Keys are `stellar keys` identities named `ambit-owner`, `ambit-agent`, `ambit-payee-a`,
`ambit-payee-b`, `ambit-deployer`, read at runtime. No secret is stored in this folder.
`state.json` holds public testnet addresses only.

```sh
cd spike && pnpm install --ignore-workspace
npx tsx src/02-add-rule.ts          # owner adds a USDC rule for the agent
npx tsx src/03-matrix.ts            # agent-signed transfers, positive and negative
npx tsx src/04-expiry-revoke.ts     # rule expiry and removal
npx tsx src/05-x402-scheme.ts       # x402 exact scheme with a smart account payer
npx tsx src/05b-x402-isolate.ts     # isolate the facilitator event check
```
