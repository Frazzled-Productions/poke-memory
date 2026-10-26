## Purpose

Return mode eases a player back in after a break of 7 or more days: a small review session that
grows each day studied, new cards paused, a bounded one-off postpone of the most stable overdue
cards, a neutral "welcome back", and today's goal instead of the backlog total (poke-memory #2191).

## ADDED Requirements

### Requirement: Return mode starts after a 7-day gap

At session load, when the setting `returnModeEnabled` is on (default on), return mode is not active,
and the latest `lastReview` among the player's cards in the active locale is 7 or more UTC days
before today, return mode SHALL start: `returnModeStartedOn` is set to today and
`returnModeStudyDays` to 0.

#### Scenario: Back after three weeks

- **WHEN** the latest review was 21 days ago and the setting is on
- **THEN** return mode starts today

#### Scenario: Six days away

- **WHEN** the latest review was 6 days ago
- **THEN** return mode does not start

#### Scenario: Setting off

- **WHEN** the player has turned "Ease me back in after a break" off and was away 30 days
- **THEN** return mode does not start and the normal queue applies

#### Scenario: Never studied

- **WHEN** a player has no reviewed cards
- **THEN** return mode does not start

### Requirement: A total review cap that doubles each day studied

While return mode is active, the total number of review cards admitted on a day SHALL be at most
20 on the first study day, 40 on the second and 80 on the third, minus reviews already done that day.
The total SHALL be split across directions in proportion to each direction's due reviews (largest
remainder), and no direction SHALL exceed its own cap.

#### Scenario: First day back

- **WHEN** return mode is on its first study day with 300 name and 100 reverse reviews due
- **THEN** 15 name and 5 reverse reviews are queued, likely-remembered first

#### Scenario: Second study day

- **WHEN** the player studied yesterday in return mode and returns today
- **THEN** up to 40 reviews are queued

### Requirement: Return mode ends after the ramp or when caught up

A day counts as studied when at least one review is graded. Return mode SHALL end (clearing
`returnModeStartedOn`) when a session loads after three studied days, or at any session load with no
overdue review cards in the active locale. A new gap of 7 or more days SHALL restart it at day one.

#### Scenario: Caught up early

- **WHEN** on the second study day the player clears every overdue review
- **THEN** the next session load ends return mode and normal caps apply

#### Scenario: Lapse again mid-ramp

- **WHEN** a player studied one day in return mode and then was away 10 days
- **THEN** return mode restarts at 20 reviews, with a fresh postpone

### Requirement: New cards are paused during return mode

While return mode is active, no new cards SHALL be introduced, including priority species. The
session SHALL show one line explaining that new Pokémon come back once the player is back up to speed.
New cards resume automatically when return mode ends.

#### Scenario: Paused

- **WHEN** return mode is active and new cards remain
- **THEN** the session introduces none and shows the explanation instead of the "new cards locked" state

### Requirement: "Keep going" lifts the return cap

After the day's return-mode goal is done, the end screen SHALL say the player is done for today and
offer "Keep going", which SHALL lift the return-mode total cap for the rest of the session in the same
way "Keep reviewing" lifts review caps today. It SHALL NOT unpause new cards.

#### Scenario: Keep going

- **WHEN** the player finishes the 20 and taps "Keep going"
- **THEN** further reviews are served within the per-direction caps, likely-remembered first

### Requirement: A bounded one-off postpone when return mode starts

When return mode starts, overdue review cards not admitted on the first day SHALL be considered for
postpone in order of highest retrievability, then highest stability. Each postponed card's `dueDate`
SHALL move later by at most 15% of its `scheduledDays` (rounded down; cards where that is 0 days are
not moved). The postpone SHALL change only `dueDate`.

#### Scenario: Stable card postponed

- **WHEN** return mode starts and an overdue card has `scheduledDays` 40 and high retrievability
- **THEN** its `dueDate` moves later by at most 6 days and nothing else on the card changes

#### Scenario: Short interval

- **WHEN** an overdue card has `scheduledDays` 5
- **THEN** it is not moved

### Requirement: Postpone never changes the memory model or trips the sync guard

The postpone SHALL NOT change `scheduledDays`, `stability`, `difficulty`, `lastReview`, `reps`,
`lapses` or `fsrsState`. A postponed card pushed to the cloud SHALL pass
`card_reviews_reject_regression_trigger`, and a stale copy of it pushed from another device SHALL also
pass. The next review SHALL see the true elapsed time since `lastReview`.

#### Scenario: Stale device pushes its copy

- **WHEN** device A postponed a card and device B, which did not, pushes its copy of that card with the earlier `dueDate` and the same `lastReview`
- **THEN** the push is accepted (no regression error) and sync does not flip into error

#### Scenario: Superuser flag on

- **WHEN** a superuser flag is on when return mode starts
- **THEN** the postponed `dueDate`s are saved on the device and not pushed, as for any card write under the write-guard

### Requirement: Return mode shows today's goal, never the backlog total

While return mode is active, every due figure the player sees SHALL show what is left of today's
return-mode goal, never the raw overdue total. That covers the practice counter, the app-icon and
title badges, the language switcher's due line, and the daily push count.

#### Scenario: Language switcher

- **WHEN** return mode is active on day one with 740 overdue cards
- **THEN** the language switcher and the practice counter say 20 (then fewer as the player grades), not 740

#### Scenario: Daily push

- **WHEN** a signed-in player is in return mode and the daily push runs
- **THEN** its count is today's remaining goal, read from the synced return-mode settings

### Requirement: A neutral welcome back, led by the partner

On the first session of return mode, the Practice page SHALL show a welcome-back card: "Welcome back!
Let's warm up with 20 Pokémon." with the player's favourite partner when one is set. The copy SHALL
NOT mention the streak, missed days or forgetting, and SHALL be in all four locales.

#### Scenario: With a favourite

- **WHEN** return mode starts and Gengar is the favourite
- **THEN** the welcome-back card shows Gengar as the partner (silhouette if not mastered)

#### Scenario: Japanese interface

- **WHEN** the app language is `ja`
- **THEN** the welcome-back card and the paused-new-cards line come from the Japanese catalogue

### Requirement: Return mode state syncs like other settings

`returnModeEnabled` (boolean), `returnModeStartedOn` (UTC date string or null) and
`returnModeStudyDays` (number) SHALL be top-level settings keys, synced for signed-in players and
device-only for guests. A cloud pull SHALL keep the device's values for these keys when the cloud row
lacks them, and SHALL NOT push their defaults (as for the #2187 favourite keys).

#### Scenario: Two devices

- **WHEN** a player starts return mode on a phone and later opens the laptop
- **THEN** after a pull the laptop continues the same ramp day count

#### Scenario: Older app version

- **WHEN** a device on the previous release changes another setting
- **THEN** its patch does not include the return-mode keys and the cloud keeps them
