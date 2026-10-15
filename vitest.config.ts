import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ADMIN_PASSPHRASE: "test-pass" },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup/d1.ts"],
      // workerd 上の統合テストは、全件を並列に流すとまれに数秒止まる（既定の 5 秒で落ちることがあった）
      testTimeout: 30_000,
    },
  };
});
