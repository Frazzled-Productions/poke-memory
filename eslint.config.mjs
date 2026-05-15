import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / non-source trees that must never be linted. `.claude/worktrees/`
    // is background-job scratch space (gitignored) — without this, a nested
    // worktree linting itself recurses into every other worktree. `coverage/`
    // holds vitest's generated reports.
    ".claude/**",
    "coverage/**",
  ]),
  // Baseline for adopting ESLint into CI (#614). The react-hooks plugin v7
  // (bundled with eslint-config-next 16) ships several new rules at `error`
  // that flag deliberate, tested patterns across the existing sync / review /
  // superuser code. These four stay at `warn` so the pre-existing baseline can
  // be burned down incrementally rather than in a risky multi-file refactor
  // riding on the CI-enablement change. New violations still surface as
  // warnings in CI output; tracked for cleanup in #614.
  //
  // `react-hooks/rules-of-hooks` is kept at `error` (the plugin default) so
  // genuine conditional-hook bugs still fail CI. Its only false-positives were
  // two plain `use*`-prefixed phrase builders in `lib/pokemon/triggers.ts`,
  // now silenced with targeted `eslint-disable-next-line` comments at the
  // call sites.
  //
  // `react-hooks/purity` stays at `warn` because two genuine render-impurity
  // sites remain beyond this change's scope:
  //   - components/pasture/PasturePokemon.tsx — `Math.random()` in render
  //   - components/review/ReviewSession.tsx — `Date.now()` in render
  // Once those are fixed it can be promoted to `error`.
  {
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
