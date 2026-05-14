import { defineConfig } from "vitest/config";
import path from "path";

const alias = { "@": path.resolve(__dirname, ".") };

// The integration project spins up a real Supabase branch and is excluded from
// the default fast suite. Opt in via: VITEST_INTEGRATION=1 npm run test:integration
const integrationEnabled = process.env.VITEST_INTEGRATION === "1";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          // lib/ tests must be DOM-free. Any lib/ test that uses React
          // rendering would silently run without a DOM here — move it to the
          // jsdom project below instead.
          // Exclude the integration sub-directory — those tests require a live
          // Supabase branch and run only when VITEST_INTEGRATION=1 is set.
          include: ["lib/**/*.test.ts", "lib/**/*.test.tsx"],
          exclude: ["lib/sync/integration/**"],
          environment: "node",
          setupFiles: ["./vitest.setup.node.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["components/**/*.test.tsx", "app/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      // Integration project — opt-in only. Runs against a real Supabase branch.
      // Requires SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF env vars.
      ...(integrationEnabled
        ? [
            {
              resolve: { alias },
              test: {
                name: "integration",
                include: ["lib/sync/integration/**/*.test.ts"],
                environment: "node" as const,
                // Branch operations (create, migrate, teardown) can take up to
                // 2 minutes; individual test assertions are fast once the branch
                // is ready.
                testTimeout: 30_000,
                hookTimeout: 120_000,
              },
            },
          ]
        : []),
    ],
  },
});
