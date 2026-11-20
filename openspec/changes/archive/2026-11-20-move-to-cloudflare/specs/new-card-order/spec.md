## MODIFIED Requirements

### Requirement: Stable shuffle per user per day (baseline, current behaviour)

Every ordering step SHALL use `stableShuffleForDay`, which sorts ids by an FNV-1a hash of the
date string, a per-user salt and the id (ties broken by id). The salt SHALL be the account's user id
when signed in and a per-device random UUID kept in local storage for guests. The date SHALL be
the UTC date (`todayString(new Date())`). The same user on the same day SHALL get the same order
on every call, and the order SHALL change from day to day and between users.

#### Scenario: Reload mid-day

- **WHEN** the same user reloads Practice twice on the same UTC day with the same cards
- **THEN** the new queue is in the same order both times

#### Scenario: Next day

- **WHEN** the same ids are shuffled on a different day
- **THEN** the order differs

#### Scenario: Same day across the move

- **WHEN** a player signs in again after the move on the same UTC day
- **THEN** the order matches the one they had before, because user ids are copied unchanged

<!-- source: lib/review/session.ts:507-524; lib/review/session.ts:649; components/review/ReviewSession.tsx:1126-1136; lib/identity/clientSalt.ts:17-31; components/review/ReviewSession.tsx:1888; lib/review/session.test.ts:1388-1467 -->
