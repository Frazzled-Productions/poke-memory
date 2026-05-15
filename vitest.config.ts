import { defineConfig } from "vitest/config";
import path from "path";

const alias = { "@": path.resolve(__dirname, ".") };

// The integration project runs against a local Postgres instance and is
// excluded from the default fast suite. Opt in via:
//   VITEST_INTEGRATION=1 npm run test:integration
// In CI the DATABASE_URL env var points at the GHA postgres service container.
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
          // Postgres instance and run only when VITEST_INTEGRATION=1 is set.
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
      // Integration project — opt-in only. Runs against a local Postgres
      // service container (GHA services: block) or any DATABASE_URL instance.
      // No Supabase API calls or branch quota required.
      ...(integrationEnabled
        ? [
            {
              resolve: { alias },
              test: {
                name: "integration",
                include: ["lib/sync/integration/**/*.test.ts"],
                environment: "node" as const,
                // Run test files serially: apply-migrations must complete before
                // regression-trigger and rls tests attempt to INSERT rows.
                // Parallel execution would cause schema conflicts.
                fileParallelism: false,
                // Migration apply + fixture setup can take up to 30 s; keep
                // individual test assertions on a tighter leash.
                testTimeout: 30_000,
                hookTimeout: 60_000,
              },
            },
          ]
        : []),
    ],
  },
});
