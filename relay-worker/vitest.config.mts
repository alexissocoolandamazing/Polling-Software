import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const relayRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: relayRoot,
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: { RELAY_SHARED_SECRET: "test-relay-secret" },
      },
      wrangler: { configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)) },
    }),
  ],
});
