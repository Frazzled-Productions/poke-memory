# Changelog

All notable user-facing changes to poke-memory. Format loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<!-- Add changelog entries to changelog.d/unreleased/ — see changelog.d/README.md -->

## [0.9.37] — 2026-05-13

### Added

- Seed pipeline now emits form-aware evolution edges: `evolution_details[].region` tags in the PokéAPI chain JSON produce additional chain nodes using form pokemon IDs (e.g. Hisuian Quilava → Hisuian Typhlosion alongside the default Quilava → Typhlosion edge). Edges dedup on `(fromId, toId)`.

## [0.9.36] — 2026-05-13

### Changed

- Stats now bucket alternate-form cards by species generation (Alolan Raichu counts as Gen I). TrainerCard splits base-species mastery from forms mastered.

## [0.9.35] — 2026-05-13

### Added

- Practice scope now includes an alternate-forms axis: "Include all" (default), "Default form only", or "Choose categories" (regional, forme). The filter updates the live card count and is persisted and synced across devices.

## [0.9.34] — 2026-05-13

### Added

- Practice now includes alternate-form name/reverse/cry cards once the seed update lands.

## [0.9.33] — 2026-05-13

### Added

- Internal: seed pipeline can now enumerate alternate Pokémon forms — no user-facing surface until follow-up PRs ship UI and card generation.

## [0.9.32] — 2026-05-13

### Changed

- Refactor card identity from integer `pokemon_id` to `(card_type, subject_key)` string pair; sync conflict key updated to the composite natural key (behavior-preserving, no user-visible change).

## [0.9.31] — 2026-05-13

### Changed

- Internal: documented the `(card_type, subject_key)` card identity model and sidecar pattern in `AGENTS.md`. No user-facing surface; this lands the decision record ahead of the schema refactor.

## [0.9.30] — 2026-05-13

### Changed

- Hear-name TTS now applies phonetic respellings for ~145 commonly-mispronounced Pokémon (Mewtwo, the Eeveelutions, Rayquaza, the legendary trios, Ho-Oh, Lugia, the Tapu guardians, Galar and Paldea legendaries, and Pokémon with hyphens, accents, or gender-symbol names like Nidoran♀/♂), so default `en-GB` system voices say them noticeably better.
- TTS now ranks installed system voices by quality tier — Premium and Siri voices are preferred over Enhanced, which are preferred over the default Compact voice. If you have downloaded a higher-quality British English voice on your device, the app picks it up automatically.
- Settings → Audio shows a dismissible hint when the picked TTS voice is the low-quality "Compact" tier, pointing at the device-level setting that downloads a Premium / Enhanced voice.

## [0.9.29] — 2026-05-13

### Fixed

- Sign-in popup no longer overflows the viewport on wider mobile devices (e.g. iPhone 14 Pro Max) where the header doesn't wrap and the trigger sits at the right edge. The panel is now pinned to the viewport's right edge on mobile instead of anchoring to the trigger. (#441, follow-up to #406)

## [0.9.28] — 2026-05-13

### Added

- First-run onboarding: a welcome callout on the home page, one-shot hints on Practice / Stats / Settings explaining the grade buttons, mastery, and recall target, plus a plain-English FSRS explainer with a "Reset onboarding tips" button under Settings (#433).

## [0.9.27] — 2026-05-13

### Changed

- Practice end-state pill now labels the per-direction counts as "Done today" and uses "reviewed" so it's clear the numbers reflect work completed today rather than what's coming next.

## [0.9.26] — 2026-05-13

### Added

- Gym badges (#420): earn hidden badges when you fully master a themed group of Pokémon — gym leaders, starters across five regions, Legendary Birds, Legendary Beasts, the Lake Trio, and the Eeveelutions. Earned badges appear on the Trainer card and a reveal toast fires the moment you unlock one. No checklist, no progress bar — discovery is the fun.

## [0.9.25] — 2026-05-13

### Fixed

- Superuser: a theme picked while `pretendAllMastered` was on is now cleared when the flag is turned off (or superuser is locked), instead of silently persisting with no UI to remove it.

## [0.9.24] — 2026-05-13

### Added

- Added a "Hear name" button (🔊) that speaks the Pokémon's English name using the browser's built-in text-to-speech engine, making it easier for non-English speakers to learn correct pronunciation. The button appears on every practice card direction — name cards (post-reveal), evolution and reverse-evolution cards (next to both the prompt name and the revealed answer), sprite-picker reverse cards (next to the prompt name), and cry cards (post-reveal) — and on Pokédex detail pages. A "Speak name on reveal" setting (default off) lets the name be read automatically on every card flip; when "Play cry on reveal" is also on, the cry plays first and the spoken name follows it so the two no longer overlap.

## [0.9.23] — 2026-05-13

### Added

- Streak milestone celebration: a confetti burst and "X-day streak!" banner fires once when you cross 3 / 7 / 14 / 30 / 100 / 365 review days. Honours `prefers-reduced-motion`. (#419)

## [0.9.22] — 2026-05-13

### Added

- Added a 7-day server-side cooldown to the FSRS weight optimizer to prevent redundant CPU-bound runs; the UI now shows when the next optimization is available.

## [0.9.21] — 2026-05-13

### Changed

- Disable pinch-zoom in the installed PWA (and browser viewport) so accidental zooms no longer throw off the layout. OS-level accessibility zoom still works.

## [0.9.20] — 2026-05-13

### Fixed

- Stats page: review activity heatmap now scales to fit narrow viewports instead of requiring a horizontal scroll on mobile.

## [0.9.19] — 2026-05-13

### Changed

- Removed the manual Sync button from Stats. Background sync paths (per-grade push, unload safety-net, visibility-pull) now handle all cases. When the unload beacon fails, the Stats sync status line becomes a one-click Retry that re-pushes only the failed cards — no pull, no full-sweep.

## [0.9.18] — 2026-05-13

### Changed

- Overhauled theming: light mode now has an off-white body and surfaces carry a faint mascot wash; dark mode buttons and surfaces have stronger contrast against the body; the chosen mascot's palette now drives focus rings, primary CTAs, progress fills and stats type bars in addition to the nav. Added a "Theme intensity" setting (Subtle accents / Tinted backgrounds / Full mascot theme) so users can dial how loud the mascot theming is. Grade buttons (Again/Hard/Good/Easy) now use saturated colour fills with a backdrop-agnostic outline. New brand-default Poké-ball-red palette gives accents even before any mascot is mastered. Added a faint mascot/Poké-ball watermark at higher intensities, and a hidden Theme audit page (linked from the Developer section) for previewing every mascot × intensity × colour scheme combination.

## [0.9.17] — 2026-05-13

### Changed

- Review cards now show a direction badge ("Evolution" / "Pre-evolution" / "Name this Pokémon" / "Pick the sprite" / "Name from cry"), and evolution-style cards render a structural "from → to" layout so the card type is obvious at a glance.

## [0.9.16] — 2026-05-13

### Fixed

- Sign-in popup no longer renders off-screen on narrow viewports — the panel now hangs from the left of the trigger on mobile and clamps to the viewport width.

## [0.9.15] — 2026-05-13

### Added

- README user-count badge refreshed daily by a GitHub Actions workflow against the Supabase Management API.

### Changed

- Pasture: each habitat now renders an illustrated SVG biome scene (sky, terrain, props) instead of a flat-tinted band, with sprites clustered on the ground and scaled by depth.

## [0.9.14] — 2026-05-13

### Fixed

- Settings → About now reflects the latest released version after a release lands. The Vercel ignored-build-step was skipping `chore(release):` commits, but `next.config.ts` bakes `pkg.version` into the bundle, so production was always one release behind.

## [0.9.13] — 2026-05-13

### Fixed

- Superuser **Pretend all mastered** now reveals the Pasture nav link too — previously the link was hidden until the user had a real mastered card, so the cheat had nothing visible to navigate to.

## [0.9.12] — 2026-05-13

### Fixed

- Sign-in and Sync Now on a device without prior local data no longer silently drop reverse and cry cards. The brand-new-device seeding paths now pull cloud settings before building the base session so all enabled card types are included in the merge.

## [0.9.11] — 2026-05-13

### Added

- Personalize my schedule: signed-in users with 200+ reviews can now run a one-click FSRS weight optimizer from Settings, tuning the scheduler to their own memory.

## [0.9.10] — 2026-05-13

### Fixed

- The Higher-or-Lower mini-game now appears on the daily new-card and review caps, not just on a pure all-caught-up session. Reverse-evolution cards now also feed into the seen-Pokémon pool (#386).

## [0.9.9] — 2026-05-13

### Fixed

- Superuser **Pretend all mastered** now populates the pasture with every species, not just those already in localStorage.

## [0.9.8] — 2026-05-13

### Fixed

- Remove orphan cloud rows from the pre-#344 evolution-card scheme so previously-graded evolution cards no longer reappear in the review queue.

## [0.9.7] — 2026-05-13

### Changed

- Superuser mode now exposes per-behaviour flags via a Developer section on the Settings page. The first flag, `pretendAllMastered`, correctly renders the Pasture, Stats (mastery bar, generation breakdown, trainer level, type breakdown), Records & milestones, and the mastered-Pokémon theme picker as fully mastered — previously these surfaces ignored superuser. While any flag is on, sync to the cloud is paused so QA state can't leak into real data; turning off the last flag restores cloud state.

## [0.9.6] — 2026-05-13

### Changed

- Updated README and CHANGELOG to point users at `pokememory.com` (the canonical domain) instead of the stale `poke-memory-alpha.vercel.app` preview URL.

## [0.9.5] — 2026-05-13

### Fixed

- Pasture nav link appears immediately after mastering your first Pokémon — no page reload required (#376).
- Pasture detail popover no longer shifts the date back a day for users west of UTC (#374).
- Tapping a Pokémon while its detail popover is open now closes the popover and plays the cry, instead of being a dead tap (#375).
- Pasture detail popover labels the displayed date as "First seen" instead of "Mastered" — it shows the date of first review, not the mastery threshold crossing (#374).

## [0.9.4] — 2026-05-13

### Fixed

- Browser tab now shows the full Pokédex favicon (with indicator lights) instead of the simplified red-and-blue mark. The 32×32 `icon.tsx` route has been removed; browsers now downscale the 192×192 `icon2.tsx` for tabs.

## [0.9.3] — 2026-05-13

### Added

- CI gate (`version-bump-gate.yml`) blocks PRs that request a non-patch version bump unless they carry the `version-bump:approved` label.

## [0.9.2] — 2026-05-13

### Changed

- Vercel preview deployments are now gated on a green CI run plus an LGTM auto-review verdict on the same commit, eliminating wasted builds on intermediate fix commits. Maintainers can comment `/preview` on a PR to bypass the gate for mid-iteration peeks.

## [0.9.1] — 2026-05-13

### Fixed

- Manual Sync no longer overwrites today's local grades when cloud is stale. The Stats-page Sync button now uses the same protective merge rule as the background pull — local progress since the last anchored pull is preserved, and the merged result is pushed up so cloud catches up.

## [0.9.0] — 2026-05-13

### Added

- Sign in with Google as a second OAuth provider alongside GitHub. The sign-in button now opens a picker with both options.

## [0.8.8] — 2026-05-13

### Fixed

- Sync no longer rewinds today's reviews on PWA cold reopen. `useManualSync` now persists `lastPullAt` after a successful pull, and the background-pull merge keeps any card with local progress when `lastPullAt` is null instead of unconditionally taking the cloud row.

## [0.8.7] — 2026-05-13

### Added

- Higher-or-Lower base-stat mini-game on the "All caught up!" screen. Pick which Pokémon has the higher stat; ties count as correct. Best-ever streak persists across devices.

## [0.8.6] — 2026-05-13

### Fixed

- Automated commits from `auto-pr`, `auto-release`, `auto-resolve`, and `auto-issue` now show `poke-memory-bot[bot]` as author instead of `claude[bot]`.

## [0.8.5] — 2026-05-13

### Changed

- Streak now requires at least 5 graded cards in a day (or all due cards cleared) to count, so a single tap no longer maintains a streak.

## [0.8.4] — 2026-05-13

### Changed

- Trainer card now shows a progress line ("N / M mastered · X to Lv K+1") and a tooltip explaining what drives your trainer level.

## [0.8.3] — 2026-05-13

### Added

- Reverse-direction evolution cards: opt-in card type that quizzes the opposite direction of every forward evolution edge ("Which Pokémon evolves into Jolteon if you use a Thunder Stone?"). Enable from **Settings → Reverse-evolution cards**. Shares the same daily new/review budget as forward evolution cards.

## [0.8.2] — 2026-05-13

### Removed

- Removed the half-built "Audio mode" pill from the practice page. The pill only rendered on reverse cards (where it had no audible effect because reverse cards never reach the reveal step), and on name/evolution cards the cry was already covered by the existing **Settings → Play cry on reveal** toggle. The wake-lock affordance will return when proper hands-free audio mode is implemented as part of a future change.

## [0.8.1] — 2026-05-13

### Fixed

- Sync: pull cloud state automatically on sign-in or cold-load while authenticated, so a fresh device immediately reflects today's progress instead of showing the seed session as "all new cards" until the user manually syncs.

## [0.8.0] — 2026-05-13

### Added

- Practice scope (generations, types, presets) is now persistent and synced — set it on one device and it follows you across devices. Cards outside the active scope are paused: their review dates shift forward by the time they were hidden, so removing the scope doesn't drop a pile of overdue reviews on you and FSRS doesn't treat the gap as forgetting.

## [0.7.21] — 2026-05-13

### Changed

- Evolution cards now ask one question per branch, with the trigger named in the prompt — `What does Eevee evolve into using a Thunder Stone?` → Jolteon. Branching pre-evolutions (Eevee, Tyrogue, Slowpoke) become several independently-gradeable cards instead of one card revealing every branch at once.
- One-time reset: evolution-card FSRS progress is cleared on first load after this release; name, reverse, and cry cards are untouched. Existing cloud rows for the old per-pre-evo cards are orphaned in place (no destructive cloud writes).

## [0.7.20] — 2026-05-13

### Fixed

- Practice page now fits on mobile viewports (e.g. iPhone 17 Pro) without scrolling — tightened padding, gaps, and sprite size on small screens.

## [0.7.19] — 2026-05-12

### Added

- New third card direction: cry → name. Audio plays as the prompt; tap Reveal to see the sprite and name. Toggle on under Settings → "Cry → name cards". Species without a cry are skipped automatically. Each direction is scheduled independently.

## [0.7.18] — 2026-05-12

### Added

- New "Audio mode" toggle on the Practice page. When on, the screen stays awake via the Wake Lock API and the Pokémon cry plays automatically on reveal regardless of the standalone Cry-on-Reveal setting.

## [0.7.17] — 2026-05-12

### Added

- Practice page now has a Scope control to narrow a session to specific generations, types, or preset groups (Starters, Legendaries). Out-of-scope cards' due dates continue advancing; the scope persists across reloads and clears in one click.

## [0.7.16] — 2026-05-12

### Added

- After completing a session the Practice page now offers a "Share today" button. It generates a spoiler-safe text summary (counts plus a Wordle-style grade-colour grid) and uses the Web Share API on mobile or copies to the clipboard on desktop.

## [0.7.15] — 2026-05-12

### Added

- The Practice page now has an "Undo last grade" affordance (button + ⌘/Ctrl+Z) that reverts the most recent grade, restores the session tally, and returns to the just-graded card. The undo expires once the next card is graded.

## [0.7.14] — 2026-05-12

### Changed

- Learning and relearning steps now adapt to FSRS difficulty: easy cards (difficulty ≤4) graduate after a single 1-minute step, medium cards keep the existing 1m/10m default, and hard cards (≥8) get an extra step (1m/5m/15m for learning; 5m/15m for relearning).

## [0.7.13] — 2026-05-12

### Added

- Settings page now exposes a recall-target slider (80%–97%, default 90%) that controls FSRS's desired retention rate. Lower targets schedule fewer reviews; higher targets schedule more.

## [0.7.12] — 2026-05-12

### Added

- Added a snapshot-based scheduler evaluation harness in `lib/srs/eval.ts`. Five fixture review lives are replayed through `nextReview` and their traces are pinned with `toMatchSnapshot`, so any future scheduler change surfaces as a reviewable diff.

## [0.7.11] — 2026-05-12

### Added

- Stats page now opens with a Trainer card: GitHub handle (or "Trainer"), level derived from total mastered, and a row of generation badges that light when a gen is fully mastered.

## [0.7.10] — 2026-05-12

### Added

- Stats page now includes a GitHub-style review activity heatmap covering the last 365 days, with intensity bucketed by daily review count.

## [0.7.9] — 2026-05-12

### Added

- Stats page now has a Records card showing longest streak, best review day, avg days to mastery, and most cards mastered in a 7-day window.

## [0.7.8] — 2026-05-12

### Added

- Stats page now includes a "By type" 18-cell grid showing mastered-by-type with the same colour palette as the Pokédex type chips.

## [0.7.7] — 2026-05-12

### Added

- Stats page now shows a 30-day accuracy sparkline plus a 7-day rolling accuracy headline, sourced from the grade log.

## [0.7.6] — 2026-05-12

### Changed

- The Stats page now shows a 14-day due-forecast bar chart instead of the today/tomorrow card pair, so heavy days ahead are visible at a glance.

## [0.7.5] — 2026-05-12

### Changed

- Generation rows on the Stats page are now full-row links to the matching Pokédex view (e.g. clicking "Generation 1" opens the Pokédex filtered to Gen 1).

## [0.7.4] — 2026-05-12

### Changed

- Settings, streak, and grade-log changes now sync to the cloud immediately instead of waiting for the next manual Sync. Saving a setting, recording a review, or grading a card pushes the change in the background.

## [0.7.3] — 2026-05-12

### Added

- Grade history (the 365-day rolling log that feeds stats analytics) now syncs to Supabase. A logout/login cycle no longer erases per-day grade counts, and a second signed-in device sees the same history after manual sync.

## [0.7.2] — 2026-05-12

### Changed

- Favourite Pokémon theme now syncs across devices — it's stored alongside other settings and rides the same sync flow. Existing local-only themes migrate automatically on first load after the update.

## [0.7.1] — 2026-05-12

### Changed

- Cloud sync now stores FSRS state directly (`stability`, `difficulty`, `reps`, `lapses`, `fsrs_state`) instead of legacy SM-2 fields. Existing cloud rows backfill automatically on the migration.

## [0.7.0] — 2026-05-12

### Changed

- Scheduler now uses FSRS via `ts-fsrs` instead of SM-2. Existing localStorage progress migrates automatically on first load — repetitions / interval / easeFactor become FSRS stability / difficulty / reps / lapses fields, keeping due dates and first-seen timestamps intact.

## [0.6.18] — 2026-05-12

### Added

- Streak and per-user settings now sync to Supabase. Hitting Sync uploads local streak days and settings, and pulls cloud values down so a logout/login cycle no longer loses progress.

## [0.6.17] — 2026-05-12

### Fixed

- Manual Sync now pulls cloud rows before pushing local state. A stale or emptied local session can no longer overwrite real cloud progress through the upsert path.

## [0.6.16] — 2026-05-12

### Security

- Added a Postgres trigger on `card_reviews` that rejects sync writes which would un-review or un-see a card, or move a card's `last_review` date backward. Protects cloud progress from being clobbered by a buggy client.

## [0.6.15] — 2026-05-12

### Added

- Add Vercel Analytics and Speed Insights to track page views, visitor metrics, and Core Web Vitals in production deployments.

## [0.6.14] — 2026-05-12

### Fixed

- Remove leftover `app/favicon.ico` from `create-next-app` so the browser tab shows the custom Pokéball icon from `app/icon.tsx` instead of the Next.js starter favicon.

## [0.6.13] — 2026-05-12

### Added

- Added a Screenshots section to the README with images of the practice, Pokédex grid, and Stats pages.

## [0.6.12] — 2026-05-12

### Added

- Plan staleness gate: `/go` now refuses to implement when `origin/main` has moved into planned files since the plan was written. A new `/replan` command re-runs planning against the current tree.

## [0.6.11] — 2026-05-12

### Fixed

- Settings: mastered-Pokémon theme picker now correctly re-skins the app nav; the section is hidden until at least one Pokémon is mastered, locked options no longer appear, and the section heading now reads "App Theme" instead of "Favourite Pokémon".

## [0.6.10] — 2026-05-12

### Fixed

- Pokédex type filter now uses AND/intersection when multiple types are selected — picking Fire + Flying returns only dual Fire/Flying Pokémon, not every Fire-type and every Flying-type.

## [0.6.9] — 2026-05-12

### Added

- Added "Play cry on reveal" setting. When enabled, plays the Pokémon's cry audio once on card reveal for name and evolution cards. Reverse cards are not affected.

## [0.6.8] — 2026-05-12

### Added

- Playwright E2E smoke tests running against Vercel preview deployments.

## [0.6.7] — 2026-05-12

### Added

- Added Anki-style learning affordances: per-button interval previews showing how soon each grade would reschedule the card, a live New/Learning/Review counter row updated on every grade, and a 20-minute learn-ahead that eliminates "wait N minutes" screens during active sessions.

## [0.6.6] — 2026-05-12

### Added

- Seed script now captures Pokémon cry URLs (`cryUrl: string | null`) and self-hosts `.ogg` files under `public/cries/` — used by the play-cry-on-reveal feature (#245).

## [0.6.5] — 2026-05-12

### Fixed

- Vercel ignore-build script no longer rebuilds on `chore(release):` commits or workflow-only pushes.

## [0.6.4] — 2026-05-12

### Fixed

- `/fix` cycle no longer hits `--max-turns` before posting `auto-review:2`: the CI-wait polling loop now runs as a single Bash invocation instead of one agent turn per iteration, and `--max-turns` raised from 80 to 120 for headroom on large punch lists.

## [0.6.3] — 2026-05-12

### Fixed

- CI agents are prevented from invoking slash-command skills (e.g. `fewer-permission-prompts`) when a permission denial fires; `--disable-slash-commands` and `--disallowed-tools Skill` are now passed to all 12 `claude-code-action@v1` invocations across 10 workflow files.

## [0.6.2] — 2026-05-12

### Fixed

- Fixed `pr-check-monitor.yml` failing at workflow-file load time due to a YAML block-scalar indentation error in the heredoc body; the workflow now runs on its 15-minute schedule as intended.

## [0.6.1] — 2026-05-12

### Fixed

- Restore patch-by-default release bumps under the fragment-based workflow; PR 234 inadvertently reverted PR 230 by treating `added/changed/removed/deprecated` fragments as minor bumps. Minor is now opt-in only via a `kind: minor-bump` fragment.

## [0.6.0] — 2026-05-12

### Changed

- **Changelog now uses fragment files** — contributors drop a file under `changelog.d/unreleased/` instead of editing `CHANGELOG.md` directly, eliminating merge conflicts when multiple PRs land in parallel. See `changelog.d/README.md` for the format.

## [0.5.2] — 2026-05-12

### Changed

- **Sprites are now self-hosted** — all 1025 Pokémon sprites are served as static assets from the same Vercel deployment (`/sprites/pokemon/{id}.png`) instead of being fetched from `raw.githubusercontent.com` at runtime. No sprite requests leave our infrastructure.

## [0.5.1] — 2026-05-12

### Changed

- Pre-v1 release bump default changed from minor (on Added/Changed/Removed/Deprecated) to patch. Minor bump is now opt-in via a `kind: minor-bump` fragment in `changelog.d/unreleased/` (previously `> bump: minor` in `[Unreleased]`).

## [0.5.0] — 2026-05-12

### Added

- **Digest proposals can now be filed as issues** — `auto-codequality-suggest` and `auto-app-suggest` digest issues now include a `- [ ] File this as an issue` checkbox on each proposal; checking one triggers the new `auto-digest-fanout.yml` workflow, which creates a child issue carrying the correct priority label, `area:app`, and a backlink to the digest. Closes #221.

## [0.4.0] — 2026-05-12

### Changed

- **Auto-labelling removed** — `auto-label.yml` (which classified issues and PRs via Claude) has been deleted. Labels on new issues and PRs are applied manually or by the workflow that creates them (e.g. the weekly digest workflows already apply all three label dimensions at creation). This reduces steady-state workflow dispatch volume. Closes #225.

### Added

- **PR dispatch monitor** — a new `pr-check-monitor.yml` workflow runs every 15 minutes and detects PRs where the CI `test` check was never dispatched (a symptom of GitHub's push/pull_request event throttle). When it finds a stuck PR, it posts a `<!-- pr-check-monitor:{sha} -->` comment with step-by-step recovery instructions. The workflow uses a schedule trigger (independent of webhook dispatch) so it fires even during a throttle window. Closes #225.

## [0.3.0] — 2026-05-12

### Changed

- **Weekly digest split in two**: `auto-app-suggest.yml` renamed to
  `auto-codequality-suggest.yml` (Wednesday 09:00 UTC, title prefix
  "Weekly code-quality review"), and a new `auto-app-suggest.yml` added
  (Thursday 09:00 UTC) that surfaces user-facing feature ideas from open
  enhancement issues, thin app surfaces, README gaps, CHANGELOG themes, and
  the latest workflow digest. Closes #220.

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

- **Live at [pokememory.com](https://pokememory.com)** — hosted on Vercel, auto-deploys on every push to `main`.

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

[Unreleased]: https://github.com/fraserbrookhouse/poke-memory/compare/v0.9.37...HEAD
[0.9.37]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.37
[0.9.36]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.36
[0.9.35]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.35
[0.9.34]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.34
[0.9.33]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.33
[0.9.32]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.32
[0.9.31]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.31
[0.9.30]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.30
[0.9.29]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.29
[0.9.28]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.28
[0.9.27]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.27
[0.9.26]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.26
[0.9.25]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.25
[0.9.24]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.24
[0.9.23]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.23
[0.9.22]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.22
[0.9.21]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.21
[0.9.20]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.20
[0.9.19]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.19
[0.9.18]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.18
[0.9.17]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.17
[0.9.16]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.16
[0.9.15]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.15
[0.9.14]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.14
[0.9.13]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.13
[0.9.12]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.12
[0.9.11]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.11
[0.9.10]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.10
[0.9.9]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.9
[0.9.8]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.8
[0.9.7]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.7
[0.9.6]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.6
[0.9.5]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.5
[0.9.4]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.4
[0.9.3]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.3
[0.9.2]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.2
[0.9.1]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.1
[0.9.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.9.0
[0.8.8]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.8
[0.8.7]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.7
[0.8.6]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.6
[0.8.5]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.5
[0.8.4]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.4
[0.8.3]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.3
[0.8.2]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.2
[0.8.1]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.1
[0.8.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.8.0
[0.7.21]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.21
[0.7.20]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.20
[0.7.19]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.19
[0.7.18]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.18
[0.7.17]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.17
[0.7.16]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.16
[0.7.15]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.15
[0.7.14]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.14
[0.7.13]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.13
[0.7.12]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.12
[0.7.11]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.11
[0.7.10]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.10
[0.7.9]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.9
[0.7.8]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.8
[0.7.7]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.7
[0.7.6]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.6
[0.7.5]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.5
[0.7.4]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.4
[0.7.3]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.3
[0.7.2]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.2
[0.7.1]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.1
[0.7.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.7.0
[0.6.18]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.18
[0.6.17]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.17
[0.6.16]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.16
[0.6.15]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.15
[0.6.14]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.14
[0.6.13]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.13
[0.6.12]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.12
[0.6.11]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.11
[0.6.10]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.10
[0.6.9]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.9
[0.6.8]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.8
[0.6.7]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.7
[0.6.6]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.6
[0.6.5]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.5
[0.6.4]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.4
[0.6.3]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.3
[0.6.2]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.2
[0.6.1]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.1
[0.6.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.6.0
[0.5.2]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.5.2
[0.5.1]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.5.1
[0.5.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.5.0
[0.4.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.4.0
[0.3.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.3.0
[0.2.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.2.0
[0.1.0]: https://github.com/fraserbrookhouse/poke-memory/releases/tag/v0.1.0
