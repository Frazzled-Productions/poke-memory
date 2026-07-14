import { defineConfig } from "vitest/config";
import path from "path";
import coverageFloor from "./coverage-floor.json";

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
      // Global floor (regression guard, #824). Values live in
      // ./coverage-floor.json — the single source of truth read by this
      // config, by .github/workflows/coverage.yml's PR-comment template, and
      // referenced (no hardcoded numbers) from AGENTS.md and WORKFLOW.md
      // prose. Ratchet upward as coverage improves — never downward to make
      // a red build pass. The /batch-issues skill ratchets the JSON file at
      // the end of every session that touches product code; manual ratchets
      // are also fine.
      //
      // Important: the JSON file must contain only the four threshold keys
      // (statements / branches / functions / lines). Vitest iterates every
      // key on this object and treats unknown ones as per-file glob
      // patterns, so a `_comment` or `description` field would be evaluated
      // as a picomatch glob on every coverage run. Keep ratchet rationale in
      // this comment block, not in the JSON.
      thresholds: coverageFloor,
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
        // Service-worker source (#703). Runs in a ServiceWorkerGlobalScope,
        // not reachable from jsdom, so it carries no unit-coverage signal.
        // The pure, testable half lives in lib/pwa/cacheStrategy.ts, which is
        // covered. ServiceWorkerProvider.tsx is instrumented again (#1915):
        // it has jsdom tests mocking @serwist/window at the module boundary.
        "app/sw.ts",
        "app/sw/**",
        // Test-only throw route exercised by the e2e error-boundary spec, not unit tests.
        "app/test-error/**",
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
          include: [
            "lib/**/*.test.ts",
            "lib/**/*.test.tsx",
            // CI tooling under scripts/lib/ (e.g. the shared changelog-fragment
            // parser, #1664) is pure and DOM-free, so it runs in the node project.
            "scripts/**/*.test.mjs",
            // QA cloud-seed dataset tests (#1707). TypeScript, DOM-free.
            "scripts/**/*.test.ts",
          ],
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
