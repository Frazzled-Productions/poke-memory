# Changelog

All notable user-facing changes to poke-memory. Format loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Sprites are now self-hosted** — all 1025 Pokémon sprites are served as static assets from the same Vercel deployment (`/sprites/pokemon/{id}.png`) instead of being fetched from `raw.githubusercontent.com` at runtime. No sprite requests leave our infrastructure.

## [0.2.0] — 2026-05-12

### Added

- **Copyright footer** — a "© [year] Frazzled Productions" notice now appears at the bottom of every page.

### Changed

- **Releases now cut automatically on every merge to `main`.** A new `auto-release.yml` workflow promotes `[Unreleased]` in `CHANGELOG.md`, bumps `package.json`, commits as `chore(release): vX.Y.Z [skip ci]`, tags, pushes, and creates a matching GitHub Release. Pre-v1 SemVer rule: any `### Added`/`### Changed`/`### Removed`/`### Deprecated` entry triggers a minor bump (e.g. 0.1.0 → 0.2.0); only `### Fixed`/`### Security` entries trigger a patch bump. An empty `[Unreleased]` no-ops the workflow. The first run also backfills the missing `v0.1.0` tag and Release at the commit where v0.1.0 was originally cut. Closes #200.

### Fixed

- **CI: `label-pr` job in `auto-label.yml` no longer fails on every fresh PR** — the job was missing an `actions/checkout` step before the Claude action, causing `git fetch` to exit with code 128. Mirrors the checkout step already present in the sibling `label` job. Closes #215.
- **CI: `auto-backlog-groom.yml` no longer crashes on first `gh` call** — the workflow was missing an `actions/checkout@v6` step, causing `gh` to fail with `fatal: not a git repository` before any issue data could be fetched. Closes #216.
- **Sync: storage-full condition no longer silently loses a day's progress** — three interacting bugs caused a full review session to vanish when localStorage ran out of space: (1) name-card payloads were serialized with large seed-only arrays (`flavorTexts`, `evolutionChain`) inflating the session to ~2.5 MB on mobile browsers; (2) `pullAndMerge` ignored `saveSession` failures and dispatched a stale `StorageEvent`; (3) the manual sync button reported "all synced" even when the local write failed. The fix strips the large arrays from all card types before serialization (they are re-injected from the seed on every mount), propagates write failures out of `pullAndMerge`, and surfaces a storage-full error message on the manual sync button instead of a false success. Closes #208.

## [0.1.0] — 2026-05-11

### Fixed

- **Practice: grade buttons stay on the revealed card when a learning card becomes due** — clicking Reveal then having a background learning-card timer fire could silently switch the displayed card before you submitted a grade. The grade buttons now remain locked to the card you revealed until you press a grade button. Closes #196.
- **Practice: storage full warning banner** — when localStorage runs out of space, the practice view now shows a dismissible amber banner reading "Progress saving is disabled — storage is full." The banner clears automatically once saving succeeds again (e.g. after freeing space) and can also be manually dismissed. Previously this was a silent failure with only a console warning. Closes #175.

### Changed

- **Reverse cards now use a multiple-choice sprite picker** — instead of showing a name with a hidden sprite and asking you to self-grade, reverse cards now present the Pokémon's name at the top and four sprite tiles below. Tap the correct sprite to grade `Good`; tapping the wrong one grades `Again` and briefly highlights the correct tile before advancing. No reveal step, no manual grading buttons. Closes #185.

### Added

- **Settings: app version displayed** — a new "About" section on the Settings page shows the current app version (e.g. `v0.1.0`). The version is read from `package.json` at build time via `NEXT_PUBLIC_APP_VERSION` and updates automatically on each deploy. Closes #201.

- **Sync: auto-pull on tab focus** — when you return to a signed-in tab that has been in the background for ≥ 30 seconds, the app silently pulls your latest cloud progress and merges it into your local session. Stats and Pokédex pages re-render immediately without a manual sync or page reload. The practice session (`/`) is excluded to avoid interrupting an active review. Closes #95.

### Fixed

- **Practice: graded card no longer reappears after mobile tab reload** — on mobile (especially Safari iOS), backgrounding the browser tab causes the OS to evict the page and trigger a full reload on return. If a card was mid-learning-step when the tab was evicted and the persisted state was missing `stepStartedAt` (a migration gap from an earlier schema), the queue builder treated the card as immediately due on every reload, re-showing it before the step timer had elapsed. The fix gives such cards a fresh step window on reload (60 s for new cards, 10 min for lapsed cards) so the correct countdown is shown instead. The persistence migration now also writes a concrete `stepStartedAt` timestamp for any in-learning card missing the field, preventing the same race on subsequent loads. Closes #186.

- **Sync: mobile reviews now survive page hide** — the session-end sync push previously used the Supabase JS client's plain `fetch`, which browsers terminate on page discard/OS suspend. The unload path now uses `navigator.sendBeacon` pointing to a new `/api/sync` Route Handler, which browsers guarantee to deliver even when a tab is being closed or the OS suspends the app. Reviewed cards on mobile now reliably appear on desktop after locking the screen. Closes #93.

- **Sync status shows accurate card count instead of generic failure** — when a tab closes before the debounce on the per-grade sync path fires, the unload safety-net now reports exactly how many cards failed (e.g. "1 card may be out of sync" or "3 cards may be out of sync") rather than the generic "Sync failed" banner. The generic banner is retained for full-session manual sync failures. Successful manual sync clears the straggler count. Closes #134.

- **Evolution cards: reveal sprite now matches question size** — the evolution sprite shown after tapping Reveal was rendered at 96 px while the question-side pre-evolution sprite was 320 px. Single-evolution cards now show the revealed evolution at 320 px, matching the question side. Branching evolutions (e.g. Eevee) continue to render at 96 px per sprite so the row fits the card area.

- **Evolution cards now show a fact on reveal** — tapping Reveal on an evolution card now displays a fact about the revealed evolution (type, height, Pokédex entry, etc.), matching the behaviour of name and reverse cards. For branching evolutions (multiple targets revealed simultaneously) no fact is shown, since a single fact cannot represent multiple Pokémon at once. Closes #163.

### Added

- **Superuser mode** — a maintainer-only escape hatch that bypasses all mastery gates for UI purposes. Activate via `localStorage.setItem('poke-memory:superuser', 'true')` in DevTools, or by typing `super` anywhere on the page when not focused in a text field (the same sequence toggles it off). On mobile, tap the "poke-memory" nav title 7 times within 2 seconds to toggle (works on iOS Safari and Android Chrome without DevTools). In superuser mode: all Pokémon tiles in Settings are interactive, the Pokédex grid shows every cell as mastered, and Pokédex detail pages reveal full stats and evolution chains regardless of progress. The flag persists in `localStorage` until explicitly cleared. No effect on review state, SRS scheduling, or stats. Closes #170, #177.

### Fixed

- **Reverse cards no longer crash the practice page** — enabling reverse cards with a large Pokédex (~1025 species) could push the serialised session to ~4.5 MB, triggering a `QuotaExceededError` on `localStorage.setItem`. The error propagated out of React's mount effect and Next.js rendered "this page could not load". The fix strips `flavorTexts` and `evolutionChain` from reverse cards before writing to localStorage (these fields are re-injected from the seed on every mount) and wraps the write in a try/catch so a quota error is logged and swallowed rather than crashing the page. Closes #171.

### Added

- **Weekly app codebase digest** — a new `auto-app-suggest.yml` workflow runs every Wednesday at 09:00 UTC and scans recently-changed app source files (`app/**`, `components/**`, `lib/**`, `db/**`) for tech debt, missing tests, dead code, and accessibility gaps. It files at most one digest issue per ISO week with up to five curated items, each backed by file paths and a concrete evidence snippet. Nothing is filed when nothing crosses the signal threshold. Closes #145.

- **Friendly error screen** — render-phase errors in any page now show a "Something went wrong" card with a "Try again" button instead of Next.js's raw crash screen. Closes #172.

- **Favourite Pokémon colour theme** — once you master a Pokémon from a curated list of 11 (Charizard, Pikachu, Gengar, Eevee, Snorlax, Mewtwo, Umbreon, Gardevoir, Garchomp, Lucario, and Drampa), you can elect it as your favourite on the Settings page. Electing a favourite re-skins the entire app with that Pokémon's colour palette. The theme is applied instantly with no flash on page reload. Your favourite's sprite also appears beside the logo in the navbar. Removing the favourite or resetting progress reverts to the default palette. The theme syncs across tabs via the `storage` event. Closes #164.

- **Manual sync button on Stats page** — signed-in users now see a "Sync now" button alongside the last-synced timestamp. Clicking pushes local progress to the cloud and pulls the latest cloud state, then merges it into localStorage. The button shows a spinner while syncing, turns green on success (auto-resets after 3 seconds), and surfaces errors in red so users can retry. Disabled while a sync is in flight to prevent double-clicks. Closes #98.

- **`supabase-expert` sub-agent** — a new read-only sub-agent covering Supabase Auth (GitHub OAuth, `@supabase/ssr` for Next.js 16 App Router), Postgres + RLS policy authoring, SM-2 schema design, the locked sync model, and privacy constraints. Invoke before writing any Supabase integration code, analogous to `next16-expert` for Next.js questions. Closes #143.

- **Card-type enable/disable toggles in Settings** — Name cards and Evolution cards each have a toggle on the Settings page. Disabling a type excludes it from the review queue (both new and review), de-emphasises its daily-cap inputs, and resets its SM-2 progress when re-enabled. At least one card type must remain enabled at all times. The Stats page shows a "(disabled)" annotation on the Mastery distribution section when name cards are off. Existing sessions without the new fields default to both types enabled.

### Fixed

- **`/go` and `/continue` now invoke Claude on issues again** — the same broken "Wire App token into git credential for push" step that was previously removed from `auto-pr.yml` was still present in both `auto-issue.yml` jobs (implement and continue). It caused `claude-code-action`'s internal `git fetch origin main --depth=1` to fail with dual-auth (URL-embedded Basic + global Bearer header), so `/go` runs halted ~30s in without ever invoking Claude. The Wire step has been removed from both jobs. CI continues to fire on subprocess pushes via the action's URL-embedding mechanism, matching the auto-pr.yml fix.

- **`/fix` command now invokes Claude on PRs again** — `auto-pr.yml`'s "Wire App token into git credential for push" step (added in the CI-firing fix below) wrote a global `http.https://github.com/.extraheader` with `Authorization: Bearer ${APP_TOKEN}`. `claude-code-action` already embeds the App token in the remote URL itself, so the global Bearer header was layered on top of URL-embedded Basic auth — GitHub rejected the dual-auth request, and `claude-code-action`'s internal `git fetch origin main --depth=1` failed before Claude was ever invoked. The Wire step has been removed from `auto-pr.yml`. CI still fires on `/fix`-cycle commits because the App token now reaches subprocess pushes via the action's own URL-embedding mechanism, not via a global credential.

- **Reverse-card backup import now works** — backups containing reviewed reverse cards would always fail re-import with "This file isn't a valid poke-memory backup." because reverse-card IDs (2 000 001+) were not included in the allowed-ID set. They are now.

- **Stats page no longer silently drops reverse cards** — the Stats page was calling `hydrateSession` before reading settings, so reverse cards were always filtered out regardless of the user's preference. Settings are now read first and forwarded to `hydrateSession`.

- **Disabling reverse cards now asks for confirmation** — toggling "Reverse cards" off in Settings previously discarded all reverse-card SM-2 history silently on the next page load. A browser confirmation dialog now warns that the action is irreversible before the toggle is saved.

- **Practice session reloads when settings change in another tab** — the `reverseEnabled` flag and daily limits were read once at mount and never refreshed. A `storage` event listener now triggers a page reload when the settings key changes in another tab, keeping both tabs consistent.

- **Screen readers no longer hear the answer before guessing on reverse cards** — `aria-live="polite"` was on the container that includes the Pokémon's name (the prompt the user is meant to guess). It has been moved to the fact sub-block that only appears after reveal, so only the post-reveal content is announced automatically.

- **CI now runs on `/fix`-cycle commits** — `actions/checkout` writes the App installation token to the repo-local `.git/config`, but `claude-code-action` spawns git subprocesses outside that scope, causing them to fall back to the ambient `GITHUB_TOKEN`. GitHub suppresses `pull_request: synchronize` events from `GITHUB_TOKEN`-backed pushes, so `ci.yml` never fired on `/fix`-cycle commits, leaving PRs with no `test` check on the new head SHA. Setting the App token as a global git credential (`http.https://github.com/.extraheader`) before the action step covers all subprocess trees and ensures pushes authenticate as `poke-memory-bot`. Applies to `auto-pr.yml` (fix cycles) and both `auto-issue.yml` jobs (implement and continue). Closes [#121](https://github.com/fraserbrookhouse/poke-memory/issues/121).

- **Auto-fix loop reaches Claude** — follow-up to the entry below: `auto-pr.yml` now passes `allowed_bots: poke-memory-bot` to `claude-code-action`, so bot-posted `/fix` comments from `auto-review.yml`'s autofix step actually invoke Claude. The previous fix opened the workflow's job-level `if:` gate to bot users, but the action has a separate internal allowlist that defaults to ignoring bots — without it, the job ran, posted its initial status comment, and exited reporting "No commits pushed and no auto-review posted."

- **Auto-fix loop now actually triggers `auto-pr.yml`** — the bot-posted `/fix` comment now passes `auto-pr.yml`'s job gate (previously the gate required `OWNER`/`MEMBER`/`COLLABORATOR` but GitHub App comments carry neither; `poke-memory-bot` is now explicitly allowed through). The auto-fix comment uses a cycle-specific `<!-- auto-review-autofix:N -->` marker so idempotent re-runs skip duplicate posts. The trigger threshold is tightened to `count < 2` (was `< 3`) to avoid posting an autofix that would immediately hit the cycle cap. Both verdict-reading steps in `auto-review.yml` now retry up to three times with a 2 s delay to handle GitHub API eventual consistency. Fix-cycle approval verdicts now include `@fraserbrookhouse` (matching `auto-review.yml`), ensuring the maintainer receives a notification on approval from any review cycle.

- **Auto-review comment headings and cross-references** — auto-review comments no longer use `#N` tokens in their headings or prose, which GitHub was auto-linking to unrelated issues/PRs. Headings now read `## Auto-review N` (no `#`), and prose references to prior reviews use a markdown link to the prior comment's URL. Closes [#88](https://github.com/fraserbrookhouse/poke-memory/issues/88).

### Changed

- **Auto-review now self-triggers `/fix`** — when `auto-review.yml` posts a `Needs fixes` verdict, it automatically posts a `/fix` comment on the PR (gated at the existing 3-cycle cap), so the fix loop starts without manual intervention. LGTM verdict comments now @-mention `@fraserbrookhouse` so the maintainer receives a GitHub notification when a PR is approved. Closes [#137](https://github.com/fraserbrookhouse/poke-memory/issues/137).

- **PWA `start_url` now includes `?source=pwa`** — the web app manifest's `start_url` is `/?source=pwa` instead of `/`. This lets future analytics tooling distinguish standalone PWA launches from ordinary browser visits without any code change at that time. No runtime behavior changes today. Closes [#8](https://github.com/fraserbrookhouse/poke-memory/issues/8).

### Added

- **Richer Pokémon facts** — height and weight facts now include a familiar-object comparison (e.g. "0.7 m — roughly knee-height on an adult", "6.9 kg — about as heavy as a small bowling ball"). Base happiness and base experience are shown as descriptive tier labels ("Bonds with trainers easily", "Very low XP yield") instead of raw numbers. Catch difficulty no longer shows the raw catch-rate value in parentheses. Closes [#82](https://github.com/fraserbrookhouse/poke-memory/issues/82).

- **Reverse-direction card type** — a new card mode where the Pokémon's name is shown as the prompt and you must identify the sprite on reveal. Each species gets an independent reverse card scheduled separately by SM-2. Disabled by default; enable in Settings under "Reverse cards". Disabling and re-enabling resets reverse-card review history. Closes [#56](https://github.com/fraserbrookhouse/poke-memory/issues/56).

- **Pokédex progressive disclosure** — Pokémon in the Pokédex are now revealed progressively as you learn them. Unlearned Pokémon appear as a solid-black silhouette with only the Pokédex number visible. Pokémon you have started reviewing appear greyscale with their name and type shown. Mastered Pokémon (at least 3 consecutive reviews with a projected interval of 21+ days) show their full-colour sprite, name, types, flavour text, base stats, and evolution chain. The detail page applies the same three-tier gating so navigating directly to `/pokedex/[id]` also respects your progress. Closes [#22](https://github.com/fraserbrookhouse/poke-memory/issues/22).
- **Per-grade cloud sync for signed-in users** — review grades are now pushed to Supabase immediately after each grade (debounced 200 ms to coalesce rapid re-grades after Reveal), instead of only on page unload. A single-row upsert fires per card, so a typical 100-review session generates ≤ 100 network calls rather than one 1482-row batch. The unload-time push is retained as a safety net covering any grades that failed the per-grade path. Closes [#94](https://github.com/fraserbrookhouse/poke-memory/issues/94).

- **Last-synced timestamp on Stats page** — signed-in users see a small "Last synced: HH:MM" line below the Stats page heading, updated after every successful push to the cloud. Shows "Sync failed at HH:MM — Push returned an error — will retry next session." when the most recent push failed, and "Not synced yet." before any push has occurred. Timestamp is stored in `poke-memory:sync-status:v1` in localStorage. Closes [#97](https://github.com/fraserbrookhouse/poke-memory/issues/97).

- **Pokédex search and filters** — a sticky filter bar at the top of the Pokédex page lets you find Pokémon by name (debounced search input with a clear button), filter by type using 18 multi-select type chips (OR logic), and jump to a single generation with mutually exclusive generation pills (Gen I–IX plus All). Filters are reflected in URL search params (`?q=`, `?type=`, `?gen=`) so they survive page refresh and are shareable. An empty-state message appears when no Pokémon match, with a "Clear filters" link. Closes [#54](https://github.com/fraserbrookhouse/poke-memory/issues/54).

- **`WORKFLOW.md`** — a new process-map document covering the sub-agent roster, orchestration playbook, all GitHub Actions workflows (`auto-issue`, `auto-pr`, `auto-review`, `auto-retro`, `auto-status`, `auto-label`, `ci`, `issue-overlap-scan`, `vercel-failure-autofix`), issue lifecycle state machine, build gates, graceful-exit / WIP salvage, scope-warning / `/split` rules, and retrospectives. `AGENTS.md`'s "Backlog / process" section is trimmed to agent-action rules only, with a pointer to the new doc. Closes [#101](https://github.com/fraserbrookhouse/poke-memory/issues/101).

- **Backup export and import** — a new "Backup" section on the Settings page lets you download your card progress and settings as a JSON file, and restore from a previously exported backup. Invalid files are rejected with an inline error without touching localStorage; valid imports require explicit confirmation before overwriting current progress. Closes [#57](https://github.com/fraserbrookhouse/poke-memory/issues/57).

- **Reset all progress** — a "Danger zone" section at the bottom of Settings lets you erase all your review history with a typed-confirmation dialog (you must type `RESET` to proceed). For signed-in users, cloud data in Supabase is deleted too. Closes [#58](https://github.com/fraserbrookhouse/poke-memory/issues/58).

- **Per-session and all-time grade breakdown** — a "This session" bar appears on the Practice page while you review, showing a live count of Again / Hard / Good / Easy grades (resets on navigation, as labelled). The Stats page now shows an "All-time grade breakdown" bar with cumulative totals drawn from a new `poke-memory:grade-log:v1` localStorage log. Existing sessions have no log entries; counts start accumulating from the first grade after this update. Closes [#5](https://github.com/fraserbrookhouse/poke-memory/issues/5).

- **Component test infrastructure and pre-PR test gate** — `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, and `jsdom` are now installed. Vitest is configured with two projects: `node` (existing scheduler and session tests, no DOM overhead) and `jsdom` (component tests). A `ReviewSession` reveal-flow test covers the unrevealed → revealed → graded lifecycle and would catch regressions like the one from #47. The pre-PR build gate in `auto-issue.yml` now runs `npm test` as a third step after `typecheck` and `build`. Closes [#48](https://github.com/fraserbrookhouse/poke-memory/issues/48).

- **Dependabot enabled** — weekly automated PRs for npm dependencies (grouped: Next.js, React, Tailwind, Vitest + Testing Library) and GitHub Actions. Closes [#59](https://github.com/fraserbrookhouse/poke-memory/issues/59).

- **Auto-label workflow** — newly-opened GitHub issues now receive `priority`, `type`, and `area` labels automatically via Claude classification (`auto-label.yml`), so issues filed from mobile land on the project board without manual triage.

- **Multi-device sync** -- optional GitHub sign-in syncs your review history across devices via Supabase. Guest mode is fully intact -- signing in is opt-in and signing out leaves local progress untouched. If you sign in on a device that already has progress alongside existing cloud data, a conflict picker lets you choose which side to keep. Session state is pushed to Supabase at the end of each session (visibilitychange / pagehide). Closes #9.

- **Evolution card type** — a second question format is now mixed into the review session: "What does X evolve into?" Using the same SM-2 spaced-repetition algorithm but with **per-type daily budgets** — name cards keep their existing 10 new / 100 review caps, evolution cards get a separate 5 new / 50 review default. Both are individually configurable on the Settings page (now grouped under "Name cards" and "Evolution cards" sections). Evolution cards interleave with name cards within each session; the per-type counters mean burning your evolution budget never blocks new name cards (and vice versa). Branching evolutions (Eevee → 8 forms) show all valid answers on reveal. Single-stage Pokémon (legendaries, Ditto, Lapras, etc.) produce no evolution card. Existing sessions migrate automatically — the ~457 new cards are appended with fresh SM-2 state on first load after the update; existing custom limit settings are preserved as the new name-card limits, with evolution defaults filled in. Closes #3.

### Deployment

- **Vercel build gating** — preview deploys are now skipped when a push only touches docs, workflows, or other non-app files (e.g. `*.md`, `.github/**`, `.claude/**`). A `vercel.json` `ignoreCommand` script checks `git diff` against the previous deployment SHA and exits 0 (skip) when none of `app/`, `components/`, `lib/`, `db/`, `public/`, or root config/dependency files changed. Dependabot PRs touching `package.json`/`package-lock.json` still trigger a full build. Closes [#114](https://github.com/fraserbrookhouse/poke-memory/issues/114).

- **Live at [poke-memory-alpha.vercel.app](https://poke-memory-alpha.vercel.app)** — hosted on Vercel, auto-deploys on every push to `main`.

### Fixed

- **Sign in / Sign out now work correctly** — clicking Sign in or Sign out was a no-op due to Server Actions being invoked outside `startTransition`. Both buttons now wrap their action in `startTransition`, which lets the Next.js client router process the redirect response. Buttons are disabled and show "Signing in…" / "Signing out…" while the action is in flight. Closes [#89](https://github.com/fraserbrookhouse/poke-memory/issues/89).

- **Learning-step countdown now survives page navigation** — the “Next card in X seconds” timer previously reset to the full step duration (1m or 10m) every time you left and returned to the practice page. It now persists a `stepStartedAt` timestamp on each card, so on remount the countdown correctly resumes from where it left off. Closes [#20](https://github.com/fraserbrookhouse/poke-memory/issues/20).

### Added

- **Daily streak counter** — the home page now shows a "N days streak" badge above the practice session, and the stats page has a Current streak card. A streak counts consecutive days you reviewed at least one card; missing today doesn't break the streak as long as you reviewed yesterday (grace window). Reviewed dates are persisted to `localStorage` independently from session state. Closes [#41](https://github.com/fraserbrookhouse/poke-memory/issues/41) and [#42](https://github.com/fraserbrookhouse/poke-memory/issues/42).

- **Pokémon facts on card flip** — when you hit Reveal on a review card, a randomly-selected fact about that Pokémon appears below the name alongside the grading buttons. Facts cover height, weight, type, genus (e.g. "Seed Pokémon"), generation, catch difficulty, base happiness, growth rate, habitat, gender ratio, base experience, strongest stat, and Pokédex flavour text entries. A new random fact is picked on every flip, so repeated "Again" cards show fresh information. The same facts are accessible on the Pokédex detail page in a new Facts panel. Closes [#11](https://github.com/fraserbrookhouse/poke-memory/issues/11).

- **Pokédex detail page** (`/pokedex/[id]`) — clicking any cell on the Pokédex grid now navigates to a dedicated detail page for that Pokémon. Shows the official-artwork sprite, National Déx number, type badge(s) with colour coding, a six-stat bar chart (HP / Attack / Defense / Sp. Atk / Sp. Def / Speed), a flavour-text blurb, and the full evolution chain as clickable sprite thumbnails. All 1025 species are covered, including Eevee’s 8-branch chain. Types, stats, flavour text, and evolution data are baked into `lib/pokemon/generated.json` at build time — no runtime API calls. Closes [#4](https://github.com/fraserbrookhouse/poke-memory/issues/4).

- **Settings page** (`/settings`) — configure mastery threshold (default 3), new cards per day (default 10, hard cap 1–50), and reviews per day (default 100, soft cap 1–500). Changes take effect on the next session. Stats page now reads the mastery threshold from settings rather than a hardcoded constant. Closes [#2](https://github.com/fraserbrookhouse/poke-memory/issues/2).

- **Anki-style learning steps** — new cards now cycle through `1m / 10m` learning steps within the same session before graduating to a 1-day interval; lapsed cards re-enter a single `10m` relearning step before resuming review scheduling. Same 4-button grading UX (Again / Hard / Good / Easy). When only future-due learning cards remain, the session shows a live countdown until the next card is ready. Closes [#1](https://github.com/fraserbrookhouse/poke-memory/issues/1).
- **Android PWA installability** — the web app manifest now includes a 192×192 icon with separate `"any"` and `"maskable"` purpose entries, satisfying Chrome for Android's PWA install criteria. The icon uses the same Pokédex-lens design as the iOS touch icon, scaled to 192×192. Closes [#7](https://github.com/fraserbrookhouse/poke-memory/issues/7).
- **PWA / iPhone home-screen support** — Add to Home Screen on iOS Safari now opens the app in standalone mode (no Safari chrome) with a Pokédex-themed icon. Adds `app/manifest.ts` (`display: "standalone"`), a 180×180 apple-touch-icon and a 32×32 favicon (both programmatically generated via `ImageResponse`), and the iOS-specific `appleWebApp` metadata + `viewport` theme-colour configuration.
- **Stats page** (`/stats`) — five derived stats from existing card state: mastery distribution (locked / learning / mastered as a stacked bar), total introduced with progress bar, due-today/tomorrow forecast, per-generation breakdown across gens I–IX, and a struggling-cards list (bottom 10 by ease factor). No charting library — hand-rolled bars.
- **Pokédex-fill page** (`/pokedex`) — 1025-cell grid grouped by generation. Locked cells silhouette the sprite and hide the name (preserving the surprise of unlearned Pokémon); learning and mastered cells reveal them with distinct visual treatments.
- **Top navigation** — links to Practice, Stats, and Pokédex on every page; active route highlighted.
- **Daily limits** — 10 new cards and 100 reviews per day by default. New is a hard wall (exceeding it inflates tomorrow's queue); reviews are a soft wall with a "Keep reviewing?" override.
- **Two-queue card ordering** — review cards served before new cards, with a deterministic per-day shuffle within each queue (FNV-1a hash of `id + today`). Stable for the day, rotates daily.
- **Three end-state screens** — _All caught up_, _Daily review limit reached_ (with override), _New cards locked for today_ (hard wall).
- **Daily progress pill** showing _Today: X new · Y reviews_.
- **`firstSeen` field** on each card, set exactly once on the first-ever grade — closes a hole where lapsing your way through new cards bypassed the daily limit.
- **Hydrate-on-load** — when new seed entries are added (e.g. after a re-seed), they're appended to the saved session at default state without losing existing progress.
- **Full 1025-species seed** from PokéAPI via `npm run seed`. Writes `lib/pokemon/generated.json` (committed for zero-setup checkout).
- **First end-to-end review loop** — open app → see sprite → reveal name → grade → next card. SM-2 scheduling, `localStorage` persistence, accessibility-aware UI (semantic buttons, focus rings, screen-reader announcements).

### Changed

- **Persisted session shape** grew from `ReviewCard[]` to `{ cards, limits }` to support per-user limits. Existing saved sessions are silently migrated on load.
- **`Cache Components` enabled** in `next.config.ts` — the project commits to the modern Next.js 16 caching model end-to-end.

### Project conventions (internal)

- **`workflow-expert` sub-agent** — a new read-only sub-agent for reviewing `.github/workflows/**` and `.claude/agents/**` changes. Knows idempotency markers (`<!-- auto-plan -->`, `<!-- auto-review:N -->`, `<!-- auto-status -->`, etc.), WIP salvage flow, `/fix` cycle cap, fork-PR guard, and project-board transitions. Invoke before any non-trivial workflow change, analogous to `next16-expert` for Next.js changes. Closes #138.
- **8 custom Claude Code sub-agents** covering planning, research, coding, and review. Roster and orchestration playbook in [AGENTS.md](./AGENTS.md).
- **Conventions captured in AGENTS.md** as decisions are locked in: caching, page params, PokéAPI integration, spaced repetition, documentation, privacy.
- **`auto-retro.yml` workflow** — when an issue closes via a merged PR, posts a single retrospective comment on the closed issue focused on which sub-agents earned their keep on that change. One transferable lesson per change, so the sandbox practice compounds.

- **`/continue` resume** — commenting `/continue` on an issue with a halted auto-run picks up the paused orchestrator on the existing branch, rather than starting a fresh one with `/go`.
- **Planner scope warning + `/split`** — when a plan touches too many files or surfaces, the planner appends a scope warning and a suggested split. Commenting `/split` creates the proposed child issues as native GitHub sub-issues of the parent, inheriting its priority label.
- **Standalone `auto-review.yml`** — code-review now runs as its own workflow on `pull_request` open instead of as a final step inside `auto-issue.yml`'s implement job. Bot-opened PRs still get exactly one review on creation; manually-opened PRs (e.g. when an App-permissions block forces a manual push) can opt in by adding an `auto-review` label, restoring the `/fix` loop. Closes [#33](https://github.com/fraserbrookhouse/poke-memory/issues/33).

[Unreleased]: https://github.com/fraserbrookhouse/poke-memory/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.2.0
[0.1.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.1.0
