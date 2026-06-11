---
kind: fixed
---

- F7: cry auto-play effect now fires only when the displayed card's id changes, not on every grade that updates the cards array
- F10: typed-entry normaliser folds U+2018/U+2019 typographic apostrophes to ASCII and strips ♀/♂, so Farfetch'd, Sirfetch'd, Nidoran♀ and Nidoran♂ can now be graded Good
- F19: forgetting-horizon projection now anchors on lastReview instead of dueDate, fixing the double-interval overestimate
- F28+F32: /api/feedback now rate-limits via check_rate_limit RPC and caps page/appVersion fields to 300 chars
- F29: /api/srs/optimize pre-stamps an in-progress marker before the CPU-heavy fit, closing the concurrent-request window (migration-free)
- F36: TTS speakName now threads the active pokemonNameLocale into the utterance lang and voice selection, and skips English MP3s for non-English locales
- F40: MasteryOverTimeChart tooltip now formats dates via the user's date format preference; formatXTick helper hoisted to formatChartDate in lib/utils/format-date.ts (shared with ActivityHistoryChart)
- F41: five inlined Tailwind literals replaced with class-name constants (mutedTextXs, mutedText, pageTitle)
- F44: saveSettings now falls back to pokemonNameLocale when activePokemonNameLocale is absent, preserving locale enrolment from pre-#1484 backups
- F48: future-direction forgotten pill now counts relative to the projectable population (trackedCount) rather than totalSpecies (~1025)
- F53: robots.txt Disallow rule for /audit-themes no longer has a trailing slash, correctly matching the route
- F59: pretendAllMastered past overlay now synthesises events before the earliest checkpoint so all past snapshots show the full mastered count
