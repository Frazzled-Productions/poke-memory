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
  // superuser code — and `rules-of-hooks` false-positives on plain helpers
  // named `use*` (e.g. `useItemPhrase`). Downgrading these five to `warn`
  // keeps them visible without blocking the new required check, so the
  // pre-existing baseline can be burned down incrementally rather than in a
  // risky 20-file refactor riding on the CI-enablement change. New violations
  // still surface as warnings in CI output; tracked for cleanup in #614.
  {
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
]);

export default eslintConfig;
