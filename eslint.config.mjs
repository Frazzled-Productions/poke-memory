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
    // Generated service-worker bundle (built by scripts/build-sw.mjs after
    // `next build`; gitignored). It is minified esbuild output, so linting it
    // flags spurious errors (e.g. no-this-alias on the bundled runtime), #1752.
    "public/sw/**",
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
        // Raw date API ban (#1456): forbid toLocaleDateString and new Intl.DateTimeFormat
        // in components/pages. Route through formatDate / formatShortDate
        // (lib/utils/format-date.ts) instead, so date rendering stays centralised,
        // locale-stable, and consistently formatted.
        //
        // Allowlist: lib/utils/format-date.ts itself uses Intl.DateTimeFormat internally
        // (it IS the helper) — that file is in lib/ and outside the files glob here.
        // todayInTimezone in lib/ uses Intl.DateTimeFormat similarly.
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message:
            "Do not call .toLocaleDateString() directly in components/pages. Use formatDate(iso, fmt, tz) or formatShortDate(iso, fmt) from lib/utils/format-date.ts for locale-stable, centralised date rendering (#1456).",
        },
        {
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
          message:
            "Do not construct new Intl.DateTimeFormat() directly in components/pages. Use formatDate(iso, fmt, tz), formatShortDate(iso, fmt), or todayInTimezone(tz) from lib/utils/format-date.ts instead (#1456).",
        },
        // Class-name literal ban (#1456): forbid the raw Tailwind strings that
        // lib/utils/class-names.ts constants already represent. Import and use
        // the constant instead to keep dark-mode / spacing changes in one place.
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value='text-sm text-zinc-500 dark:text-zinc-400']",
          message:
            "Use the mutedText constant from lib/utils/class-names.ts instead of this inline literal (#1456).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value='flex flex-col gap-2']",
          message:
            "Use the colStack constant from lib/utils/class-names.ts instead of this inline literal (#1456).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value='flex flex-col gap-4']",
          message:
            "Use the colStackLg constant from lib/utils/class-names.ts instead of this inline literal (#1456).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value='rounded-xl border border-zinc-200 bg-background p-4 dark:border-zinc-800']",
          message:
            "Use the cardPanel constant from lib/utils/class-names.ts instead of this inline literal (#1456).",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value='rounded-xl border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800']",
          message:
            "Use the cardPanelPadded constant from lib/utils/class-names.ts instead of this inline literal (#1456).",
        },
        // Game-label single-source guard (#1559): forbid reading `.display` from
        // a VERSION_NAMES lookup directly in components/pages. All game-label
        // strings must flow through `formatVersions(slugs)` (lib/pokemon/versionNames.ts)
        // so sort order, overflow, and unknown-slug fallback remain centralised.
        // Selector targets `VERSION_NAMES[expr].display` specifically.
        {
          selector:
            "MemberExpression[property.name='display'][object.type='MemberExpression'][object.object.name='VERSION_NAMES']",
          message:
            "Do not read VERSION_NAMES[slug].display directly in components/pages. Use formatVersions(slugs) from lib/pokemon/versionNames.ts so sort order, overflow, and fallback remain centralised (#1559).",
        },
        // Sprite pixel-literal ban (#1456): forbid raw numeric literals on the
        // `width` and `height` props of <Image> components. Use the corresponding
        // named constant from lib/sprites/sizes.ts so the optimiser variant and
        // the painted CSS size stay in sync. Non-sprite images (user avatars, SVG
        // icons) may use eslint-disable-next-line with a rationale comment.
        {
          selector:
            "JSXOpeningElement[name.name='Image'] > JSXAttribute[name.name='width'] > JSXExpressionContainer > Literal",
          message:
            "Do not inline sprite pixel sizes. Import the named constant from lib/sprites/sizes.ts (e.g. PRACTICE_SPRITE_SIZE, PICKER_SPRITE_SIZE) and use it as the width prop (#1456).",
        },
        {
          selector:
            "JSXOpeningElement[name.name='Image'] > JSXAttribute[name.name='height'] > JSXExpressionContainer > Literal",
          message:
            "Do not inline sprite pixel sizes. Import the named constant from lib/sprites/sizes.ts (e.g. PRACTICE_SPRITE_SIZE, PICKER_SPRITE_SIZE) and use it as the height prop (#1456).",
        },
      ],
    },
  },
]);

export default eslintConfig;
