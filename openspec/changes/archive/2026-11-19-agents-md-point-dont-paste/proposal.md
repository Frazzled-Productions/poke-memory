## Why

AGENTS.md pastes two sections from the company's shared rules: "OpenSpec" (62 lines, a copy of the
shared OpenSpec tooling reference) and "Delegated work and the stall watcher" (12 lines). The copies
have drifted from their source, and the file sits at its size caps. The company's shared rules now hold
one copy of each: the stall-watcher rule in the global agent rules every session loads, and the
OpenSpec tooling reference in one ops file that a repo points to (owner ruling of 14 November 2026,
"Fix the source and clean every repo now", approved with the ops change `point-dont-paste`).

Fixes: poke-memory #2384

## What Changes

- AGENTS.md "OpenSpec" becomes a short section of this repo's own lines (specs describe `qa`, the two
  checks required on `qa` only, the archive on push to `qa` on a GitHub-hosted runner with its
  `qa-staging` auto-merge, this repo's docs-only fast path) and one pointer to the shared reference.
- "Delegated work and the stall watcher" is deleted; the push rule (line 147) and the restated writing
  rule (line 136, keeping the repo's spelling exceptions) go, as both are in the global rules.
- `.github/context-budget.txt` AGENTS.md 229 to 167; `scripts/lint-agents-size.mjs` back to the caps
  before the 2026-10-23 raise (190 lines, 22 KiB), as its comment tied that raise to these sections.
- No spec delta: `skip_specs: true`. Docs and a size ceiling only; no behaviour changes.

## Also touches

- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change, because no app code, copy or route is touched.
- **Guest mode (localStorage):** no change, because no app code changes.
- **Cloud sync and Supabase migrations (both projects):** no change, because no schema, client or migration is touched.
- **Superuser mode and QA-seed scenarios:** no change, because neither reads AGENTS.md.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, because no copy changes.
- **Push notifications and the service worker (offline):** no change, because no app code changes.
- **Sign-in:** no change, because no app code changes.
- **Privacy notice and sub-processors:** no change, because the Privacy section of AGENTS.md is untouched and no data flow changes.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, because no UI changes.
- **README screenshots:** no change, because no rendered surface changes.
- **Changelog fragments and the release:** no fragment, because `changelog-gate.yml` asks for one only when `app/**`, `components/**` or `lib/**` change.
- **CI and GitHub Actions:** `npm run lint:agents-size` (in `lint`) runs at the lower caps and passes (167/190 lines, 18745/22528 bytes); "Context budget" reads the lowered number. No workflow changes.

## Out of scope

- AGENTS.md line 5 (the "sandbox" sentence): its own small PR, as the owner ruled.
- Stale versions (lines 8-9), the required-checks line 138, the SessionStart fast-forward, the
  code-reviewer agent's wording: each its own later issue.

## Owner decisions relied on

- 14 November 2026: "Fix the source and clean every repo now", and approval of the ops change
  `point-dont-paste` with this PR in its plan.
- 23 October 2026: every repo adopts OpenSpec; the shared tooling lives in `Frazzled-Productions/.github`.

## Removes

The pasted OpenSpec reference (49 lines), the stall-watcher paragraph (12 lines), the restated push
rule and writing rule; the 2026-10-23 cap raise in `scripts/lint-agents-size.mjs`.

## Clarifications

- 2026-11-14: Scope set by the owner's approval of the ops change `point-dont-paste` (decision box,
  "Approve with the recommended answers"); no separate grilling round, as the plan named this PR.
