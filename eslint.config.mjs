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
  // Multi-locale guard (#1327): forbid direct `.displayName` reads in UI code.
  // Every Pokémon name shown to a user must flow through
  // `useLocalePokemonName(speciesId, displayName)` so the active
  // `pokemonNameLocale` setting is respected.
  //
  // Allowlist rationale:
  //   app/api/**   — server-side API routes; locale is irrelevant, English baseline is correct.
  //   lib/**       — pure data layer; English baseline is correct (excluded by the files glob).
  //   scripts/**   — build-time seeders; English baseline is correct (excluded by the files glob).
  //   e2e/**       — test code (excluded by the files glob).
  //
  // False positives: `.displayName` passed as the English-fallback argument to
  // `useLocalePokemonName(speciesId, displayName)` is the intended pattern (the
  // hook receives it as a fallback, not a final render value). Those sites are
  // annotated with `// eslint-disable-next-line no-restricted-syntax` plus a
  // one-line explanation rather than narrowing the AST selector, which would be
  // more fragile.
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    ignores: ["app/api/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='displayName']",
          message:
            "Do not read .displayName directly in components/pages. Use useLocalePokemonName(speciesId, displayName) so the active pokemonNameLocale is respected.",
        },
        // Multi-locale guard (#1405 lever 2 / #1406 candidate): forbid inline
        // capitalisation of a Pokémon type id. #1389 replaced the three
        // `type.charAt(0).toUpperCase() + type.slice(1)` pill labels with
        // getTypeName(type, t) (lib/i18n/typeNames.ts). Banning the raw
        // capitalise form makes the "third surface" miss (a new type-pill
        // surface that hardcodes the English title-case) fail CI instead of
        // depending on a reviewer noticing.
        //
        // The selector targets `<expr>.charAt(0).toUpperCase()` — the exact
        // signature #1389 removed. It is deliberately narrow: it fires on the
        // inline title-case idiom (overwhelmingly used here for type ids) and
        // not on arbitrary string transforms. A type label produced any other
        // way must still route through getTypeName so the active appLocale wins.
        {
          selector:
            "CallExpression[callee.property.name='toUpperCase'][callee.object.callee.property.name='charAt']",
          message:
            "Do not inline-capitalise type ids (or other localised labels) in components/pages. Use getTypeName(type, t) from lib/i18n/typeNames.ts so the active appLocale is respected.",
        },
      ],
    },
  },
]);

export default eslintConfig;
