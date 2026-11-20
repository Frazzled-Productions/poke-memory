## 1. Order

- [ ] 1.1 `retrievabilityAt` in `lib/srs/scheduler.ts`. Verify: unit tests against `ts-fsrs` `get_retrievability` for new, young and old cards, written failing first.
- [ ] 1.2 `buildSessionQueues` picks and serves capped reviews by retrievability, hash as tie-break; all callers pass the map. Verify: "Cap binds", "Stable through the day", "Under the cap" in `lib/review/session.test.ts` (red first); `e2e/practice-grade-timing.spec.ts` green.

## 2. Return-mode state

- [ ] 2.1 Settings keys `returnModeEnabled` (default true), `returnModeStartedOn`, `returnModeStudyDays`; parse, defaults, Settings toggle in four locales. Verify: persistence tests; Settings component test per locale.
- [ ] 2.2 Pull protection: generalise `keepDeviceFavouriteKeys` to cover the three keys. Verify: `lib/sync/pullAndMerge.favourite.test.ts`-style cases for "Two devices" and no default push; older-client test "Older app version".

## 3. Return mode

- [ ] 3.1 Start detection at session load. Verify: "Back after three weeks", "Six days away", "Setting off", "Never studied".
- [ ] 3.2 `returnModeCap` and the proportional split. Verify: "First day back" (15 + 5), "Second study day".
- [ ] 3.3 End after three study days or when caught up; restart on a new gap. Verify: "Caught up early", "Lapse again mid-ramp".
- [ ] 3.4 New cards paused, explanation line. Verify: "Paused" (no new cards, no "new cards locked").
- [ ] 3.5 Done-for-today screen with "Keep going". Verify: "Keep going" component test.

## 4. Postpone

- [ ] 4.1 `postponeForReturn` ordering and 15% bound. Verify: "Stable card postponed", "Short interval".
- [ ] 4.2 Persist and push through the existing card path. Verify: ReviewSession test that a return start saves the shifted `dueDate`s once.
- [ ] 4.3 Only `dueDate` changes. Verify: unit test asserting every other state field is identical.

## 5. Display and copy

- [ ] 5.1 Today's goal in the practice counter, badges, title and language switcher. Verify: "Language switcher" and badge hook tests.
- [ ] 5.2 Push route count in return mode. Verify: route test "Daily push".
- [ ] 5.3 Welcome-back card with partner, four locales. Verify: "With a favourite", "Japanese interface"; copy check for no streak, missed-day or forgetting words.

## 6. Sync safety

- [ ] 6.1 Superuser write-guard covers postpone pushes. Verify: existing guard test extended.
- [ ] 6.2 Integration test: a `card_reviews` update changing only `due_date` (later, then a stale earlier one with the same `last_review`) is accepted by the regression trigger. Verify: `VITEST_INTEGRATION=1 npm run test:integration` in CI.

## 7. Docs and release

- [ ] 7.1 Catalogue keys in all four locales and the pseudo-locale; What's new; QA-seed "lapsed player"; `docs/childrens-code-assessment.md` Standard 13; `docs/srs.md` order and return mode. Verify: `lint:i18n`, `lint:pseudo-locale`, `test:i18n-leak`, `scenarios.test.ts`.
- [ ] 7.2 `minor-bump` and `added` fragments; `npm run pre-pr`. Verify: exit codes recorded.
- [ ] 7.3 `/opsx:verify`, blast-radius again, `final-review`. Verify: findings fixed or listed in the PR.

## 8. Follow-ups

- [x] 8.1 File one issue for the baseline review-queue oddities this change leaves alone. Verify: filed as #2193 (2026-10-26).
