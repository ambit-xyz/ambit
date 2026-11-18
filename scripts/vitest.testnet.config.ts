import { defineConfig } from "vitest/config";

// Tests that talk to Stellar testnet. Kept out of `pnpm test` so the default run stays offline.
export default defineConfig({
  test: {
    include: ["src/**/*.testnet.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
