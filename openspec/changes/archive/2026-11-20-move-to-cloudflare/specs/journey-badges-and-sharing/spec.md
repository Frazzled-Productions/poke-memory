## MODIFIED Requirements

### Requirement: Journey page load order (baseline)

The Journey page SHALL wait for the seed, then read settings, load the saved session or build a fresh
one, persist any healed cards, read streak and grade log, and show a loading skeleton until both the
mastery snapshot and the current streak exist. The load SHALL re-run when the stored session, any-flag
state, data client, user or seed changes, and not on a settings save, which looks wrong (#2339).
Metadata SHALL title the route "Journey - Poké Memory".

#### Scenario: Seed not ready

- **WHEN** the seed is still null
- **THEN** nothing loads and the page shows only its heading and the skeleton

#### Scenario: Saved session needs healing

- **WHEN** `hydrateSession` reports `anyHealed`
- **THEN** the healed cards are saved before the page uses them

#### Scenario: Language switched on the page

- **WHEN** the player switches language in the status bar while on Journey
- **THEN** the status bar, language breakdown and Pokémon names change, and the snapshot, timeline, close-to-mastery list, next-badge hint and records stay on the old language until the page remounts (#2339)

Source: `app/journey/layout.tsx:3`, `app/journey/page.tsx:424`, `app/journey/page.tsx:427`, `app/journey/page.tsx:435`, `app/journey/page.tsx:443`, `app/journey/page.tsx:560`, `app/journey/page.tsx:627`; planned `lib/db/client.ts`.

### Requirement: Earned badges persist in settings and do not regress (baseline)

Earned badges SHALL live in settings as id and `earnedAt` pairs, reach the cloud inside the settings
blob, and be replaced as a whole on write. The Worker's settings merge SHALL reject an update that
removes a badge id. A developer row in Settings, shown only in the superuser section, SHALL clear the
local list. The Journey page SHALL ignore a stored id that is not in the catalogue.

#### Scenario: A push would drop a badge

- **WHEN** an update's `earnedBadges` lacks an id the row holds
- **THEN** the settings merge refuses the regression with 23514

#### Scenario: Unknown stored id

- **WHEN** settings hold an id with no catalogue entry
- **THEN** Journey leaves it out

Source: `lib/settings/persistence.ts:338`, `lib/settings/persistence.ts:858`, `lib/settings/lastPushedSnapshot.ts:99`, `app/settings/page.tsx:139`, `app/settings/page.tsx:2102`, `app/settings/page.tsx:2199`, `app/journey/page.tsx:589`; planned `lib/db/rpc/mergeUserSettings.ts`.
