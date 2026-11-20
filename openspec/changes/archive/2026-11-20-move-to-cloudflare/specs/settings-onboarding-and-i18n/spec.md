## RENAMED Requirements

- FROM: `### Requirement: The database protects most onboarding flags (baseline, current behaviour)`
- TO: `### Requirement: The settings merge protects most onboarding flags`

## MODIFIED Requirements

### Requirement: The settings merge protects most onboarding flags

The Worker's settings merge SHALL reject a true-to-false change of 17 listed onboarding flags and a
decrease of `practiceSessionsCount` or `slowSpriteLoadCount`, unless the write carries a strictly newer
`onboardingResetAt`. `cardTypesDefaultOpenDismissed` and `masteryBlockersNudgeDismissed` are not listed,
although the type's comment requires every boolean dismissal flag to be, so the merge SHALL NOT protect
them (open issue #2318).

#### Scenario: Stale device clears a listed flag

- **WHEN** a stale write sets `statsHintDismissed` from true to false with no newer reset stamp
- **THEN** the merge rejects it with 23514

#### Scenario: Top-level one-shot flag

- **WHEN** any write sets `typedEntryOnboardingShown` or `mcCardOnboardingShown` from true to false
- **THEN** the merge rejects it, even with a newer reset stamp

#### Scenario: Stale device clears an unlisted flag

- **WHEN** a stale write sets `masteryBlockersNudgeDismissed` from true to false
- **THEN** the merge accepts it

Source: planned `lib/db/rpc/mergeUserSettings.ts`, with the rules of `db/migrations/038_user_settings_reject_regression_trigger.sql:142-202`; `lib/settings/persistence.ts:51-56`, `lib/settings/persistence.ts:197`, `lib/settings/persistence.ts:209`.

### Requirement: Some Settings copy is English in every language (baseline, current behaviour)

The re-enable and reset dialogs, most of the known-Pokémon quiz, the recall-target hint title, and the
reset and delete error messages SHALL render as fixed English in every app language (open issue #2314).
The optimiser's messages moved to `/settings/optimiser` and are translated there. The English-leak gate
SHALL run only `*.i18n-leak.test.tsx` files, none of which covers these.

#### Scenario: Japanese UI

- **WHEN** the app language is Japanese and the user turns on cry cards
- **THEN** the dialog reads in English, with an English card-type name

#### Scenario: Optimiser error in Japanese

- **WHEN** the app language is Japanese and an optimiser run fails
- **THEN** the error state on the optimiser page is in Japanese

Source: `components/settings/ReenableCardTypeDialog.tsx:58-85`, `components/settings/ResetProgressDialog.tsx:60-69`, `components/onboarding/KnownPokemonQuiz.tsx:367-381`, `components/onboarding/KnownPokemonQuiz.tsx:430-438`, `app/settings/page.tsx:247-251`, `app/settings/page.tsx:682`, `app/settings/page.tsx:697`, `app/settings/page.tsx:927`, `package.json:30`; planned `app/settings/optimiser/page.tsx`.
