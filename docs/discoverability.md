# Discoverability mechanics

Canonical reference for the poke-memory wiring behind `ops/standards/conventions.md` →
Discoverability (declare-a-discovery-path, reach-existing-users,
mock-up-on-visual-surface-proposals). AGENTS.md (Discoverability) carries the headline rule.

## Review wiring

- `ux-advisor` reviews the discovery path on the brief; `code-reviewer` raises an undeclared path
  as a **Concern** at review time.
- The mock-up requirement (#1500) is owned by `planner` (authoring tickets), the `/batch-issues`
  exploration brief, and `ux-advisor` (raises a missing mock-up as a **Concern** on the brief).

## One-shot hint mechanics

A one-shot contextual hint must use its **own new** `OnboardingFlags` key - never piggyback an
already-dismissed flag like `firstVisitOnboardingDismissed`, and never add new content to
`FirstVisitOnboardingModal` (every existing user has dismissed it). Add the new key to
`DEFAULT_ONBOARDING` (default `false`) and validate it with the `v.x === true` coercion in
`validateOnboarding`, so an absent key (= every existing user) resolves to not-seen and the hint
shows.

The version-based What's-new channel (`WhatsNewIndicator`) targets users-with-history and
suppresses first-timers - use it for the batch summary with past-tense copy, never to instruct
dismissing a hint.

**Verify in a populated existing-user state** (a settings blob predating the change, or the
`pasture-progression` / `fsrs-locale-mastery` QA-seed scenario), not only a fresh session.
