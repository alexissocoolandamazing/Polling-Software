import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", coverage: { reporter: ["text", "html"] } },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
