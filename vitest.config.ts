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
    // Coverage tooling (#762, gated in #824). `vitest run --coverage` now
    // enforces a global floor — see `thresholds` below. The floor is a
    // regression guard, not a target; the diff-coverage gate in coverage.yml
    // is what pushes new code higher.
    coverage: {
      provider: "v8",
      // text  → printed summary table (scraped by coverage.yml for the PR comment)
      // json-summary → machine-readable totals if a future job needs them
      // json  → per-file statement/branch/line hit maps (coverage-final.json),
      //         consumed by coverage.yml's diff-coverage gate
      // html  → drillable local report under coverage/
      reporter: ["text", "json-summary", "json", "html"],
      // Global floor (regression guard, #824). Set ~1.5 pts below today's
      // measured baseline (S 78.69 / B 71.93 / F 74.28 / L 80.87) rounded
      // down, so an unrelated coverage drop fails CI. Ratchet upward as
      // coverage improves — never downward to make a red build pass.
      thresholds: {
        statements: 77,
        branches: 70,
        functions: 72,
        lines: 79,
      },
      // Measure the application/library source we actually ship and test.
      include: ["app/**", "components/**", "lib/**"],
      exclude: [
        // Test files — not product code.
        "**/*.test.ts",
        "**/*.test.tsx",
        "lib/sync/integration/**",
        // Config, tooling, E2E and generated/seed data.
        "**/*.config.*",
        "vitest.setup.*",
        "e2e/**",
        "scripts/**",
        "db/**",
        // Generated seed payload — produced by scripts/seed-pokemon.mjs, not
        // hand-written, so it carries no meaningful coverage signal.
        "lib/pokemon/generated.json",
        // Service-worker code (#703). The SW source runs in a
        // ServiceWorkerGlobalScope and the registration component drives the
        // browser SW lifecycle; neither is meaningfully unit-testable. The
        // pure, testable half lives in lib/pwa/cacheStrategy.ts, which is
        // covered. Excluding these keeps them out of the diff-coverage gate.
        "app/sw.ts",
        "app/sw/**",
        "components/pwa/ServiceWorkerProvider.tsx",
        "**/*.d.ts",
        "node_modules/**",
      ],
    },
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
