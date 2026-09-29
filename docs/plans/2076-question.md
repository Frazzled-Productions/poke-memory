# Question: #2076, should `compiler.define` replace the removed Sentry debug-logging strip?

## What landed

- `next.config.ts` no longer passes `webpack.treeshake.removeDebugLogging` to `withSentryConfig`. The option did nothing, because the build uses Turbopack.
- The comments now describe the Turbopack build. Source maps upload through Sentry's `runAfterProductionCompile` hook (only when `SENTRY_AUTH_TOKEN` is set). `webpack.*` Sentry options do nothing under this build, and the comments say the SDK's debug-logging code still ships.
- `lib/observability/nextConfigSentry.test.ts` imports `next.config.ts` with `withSentryConfig` and the next-intl plugin mocked. It fails in three cases: a `webpack` key comes back, the build script opts into `--webpack`, or the source-map upload hook is turned off. I checked that it fails when the old `webpack` block is put back.

Nothing a user would notice has changed, so there is no changelog fragment.

## What is still open

The plan's main fix was `compiler: { define: { __SENTRY_DEBUG__: false } }` on `nextConfig`. The plan made shipping it depend on a before/after production build: grep `.next/static/chunks` for `Integration installed:`, a string that only appears in debug-only code in `@sentry/core`.

I could not run that build. This lane's shell is Node 26. The `prebuild` guard refuses `npm run build` there. Prefixing `PATH` or calling `npx next build` directly are both refused by the lane's permissions. So the define is **not** in this change. Shipping it unproven would repeat what #2076 complains about: config that reads as if it works when nobody knows whether it does.

What I found by reading the source instead:

- `@sentry/core` sets `DEBUG_BUILD = (typeof __SENTRY_DEBUG__ === 'undefined' || __SENTRY_DEBUG__)`. The define only helps if Turbopack also rewrites the `typeof` check. Otherwise `typeof` still returns `'undefined'` at runtime, `DEBUG_BUILD` stays `true` and nothing is stripped.
- In Next 16.3.1, `defines()` in `crates/next-core/src/util.rs` splits each `compiler.define` key on `.` into `DefinableNameSegment::Name` entries only. It adds no `DefinableNameSegment::TypeOf` entry for a user define.
- Turbopack does have a `TypeOf` segment (`turbopack-core/src/compile_time_info.rs`), which is how built-ins like `typeof window` get replaced. A Next.js PR review comment (vercel/next.js#77074) says free-var references are "consulted only for typeofs".
- I could not read Turbopack's `handle_typeof` code (the file was too large to fetch here). So I can't rule out that the analyser resolves the free variable first and then folds its `typeof`. My reading is that it **probably does not** strip anything, but only a build will tell.
- Sentry's own tree-shaking guide (sentry-docs, `platforms/javascript/guides/nextjs/configuration/tree-shaking.mdx`) says: "Tree-shaking options are not supported for Turbopack builds at the moment." It gives no Turbopack alternative.

The cost of leaving this open is small. No `Sentry.init` passes `debug: true`, so the extra code never logs anything. It only adds bundle size.

## Options

**A. Run the plan's build check under Node 24, then decide (recommended).**
Add the define on a scratch branch and run `npm run build` before and after. Then grep `.next/static/chunks` for `Integration installed:` and `Integration skipped because it was already installed`, and compare `du -sk .next/static/chunks`.
- If both markers disappear, open a small follow-up PR with the define and update the DEBUG LOGGING comment in `next.config.ts`. The new comment must say that a future `debug: true` in any `Sentry.init` would print nothing, because the define reaches server and edge bundles too.
- If the markers stay, do option C.

*Trade-off:* two local builds of a few minutes each. You get an answer backed by the build output and no config that only claims to work.

**B. Add the define now, unproven.**
It is safe at runtime today. But if Turbopack does not rewrite `typeof`, it does nothing, and the repo is back where #2076 started: an option that reads as if it strips debug code while the build ignores it. The guard test cannot catch that, because only the build output shows it.

*Trade-off:* no build needed, but it reintroduces the exact problem this issue was filed about.

**C. Accept the shipped debug code and watch for a Sentry fix.**
File a follow-up issue to adopt a Turbopack-native debug-logging option when `@sentry/nextjs` ships one. The comment in `next.config.ts` already records the current position.

*Trade-off:* costs nothing now, and the bundle keeps the debug code, which is unused at runtime, until Sentry ships an option.

**Recommendation: A, then C if the markers stay.** The only thing it needs is a Node 24 shell, which this lane does not have.

## Where this change departs from the plan

- **Plan open question 1 (enforcement):** the plan recommended comment-only (A). This change also adds the guard test (the plan's option B), because the loop requires a test for every change. The test imports the config with the SDK and the next-intl plugin mocked, so it avoids both downsides the plan named: fragile text matching, and running the real `withSentryConfig` inside a unit test. If you would rather not have it, it is a single file to delete.
- **Plan open question 2 (source-map upload check):** this follows the plan's recommendation B. The comment says the upload runs only when `SENTRY_AUTH_TOKEN` is set. Checking the Sentry project for the preview deploy's release and artifact bundle is still worth doing once.
