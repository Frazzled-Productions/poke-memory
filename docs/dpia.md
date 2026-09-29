# Data Protection Impact Assessment - Poké Memory

**Date:** May 2026  
**Controller:** Frazzled Productions Ltd (company no. 17258540) — privacy@pokememory.com  
**Reference:** Issue #721  
**Status:** Approved - sole-operator sign-off (see Step 7)

---

## Step 1 - Identify the need for a DPIA

### Trigger

Poké Memory is in scope of the UK Children's Code (ICO Age Appropriate Design Code). A Pokémon-themed learning app is "likely to be accessed by children" - this is the statutory trigger under the Children's Code, and the honest read is that it is not a borderline call. Standard 2 of the Code calls for a data protection impact assessment to be carried out. See `docs/childrens-code-assessment.md` for the full scoping analysis.

### UK GDPR Article 35(3) high-risk triggers

UK GDPR Article 35(3) mandates a DPIA before any processing that is "likely to result in a high risk". The three mandatory high-risk triggers are:

1. **Systematic and extensive profiling with significant effects on individuals.** Poké Memory does no profiling for external purposes. The FSRS algorithm adapts scheduling to the individual's own review performance, for that user's own benefit - it does not produce profiles that affect the individual in any external way. This trigger does not apply.

2. **Large-scale processing of special-category or criminal-offence data (Article 9/10).** No special-category data is collected or processed. This trigger does not apply.

3. **Systematic monitoring of publicly accessible areas.** Poké Memory is not a monitoring service. This trigger does not apply.

### Conclusion

A DPIA is **not legally mandatory** under UK GDPR Article 35. It is produced here as good practice under Children's Code Standard 2, and because it is sound data-governance practice for any service that processes personal data - however modest the processing.

---

## Step 2 - Describe the processing

### Nature

Poké Memory operates two distinct paths:

- **Guest path.** All card-review state is held in browser `localStorage`. No card or review data is transmitted to any server the controller operates. The only guest data that leaves the browser is technical error and performance diagnostics sent to Sentry (see below). Pokémon sprites are served as static files from the same Vercel infrastructure as the app - no third-party image CDN. The guest path involves no server-side personal-data processing.

- **Authenticated path.** When a user signs in via GitHub or Google OAuth, or creates a username and password account directly, per-card review state is synchronised to a Supabase Postgres database so the user can continue across devices. This is the path where UK GDPR applies in full.

The processing activities on the authenticated path are:

- Reading and writing FSRS spaced-repetition parameters for each reviewed card (stability, difficulty, scheduled interval, repetition count, lapse count, FSRS state, due date, last review date, first seen date).
- Recording the dates on which the user completed at least one review, for streak calculation.
- Appending grade events (card type, subject identifier, grade, timestamp) to a log used for per-user FSRS-weight optimisation.
- Storing and synchronising user settings (daily review limits, practice scope, theme, timezone, etc.).
- Aggregate, cookieless, anonymous analytics (Vercel Analytics and Speed Insights) collecting page path, referrer, country, device type, and Core Web Vitals across all users regardless of sign-in status.
- Error monitoring and performance tracing (Sentry) across all users regardless of sign-in status, so faults can be detected and fixed (purpose 6; risk R9).

### Scope

- **Authenticated users:** any user who signs in via GitHub or Google OAuth, or who creates a username and password account directly. The OAuth providers impose a minimum age of 13 (or 16 in some EU jurisdictions). The username/password door has no inherited age gate; age assurance for those accounts relies on the Children's Code uniform-standards approach applied to all users (see Step 6, R4, and `docs/childrens-code-assessment.md`).
- **Guest users:** any user who does not sign in, including children of any age. This is the default and primary path.
- **Analytics:** all users on both paths.

Children (up to age 18) are in scope for both paths. The Children's Code assessment (`docs/childrens-code-assessment.md`) treats guest users of all ages and authenticated users aged 13–18 as in scope.

### Context

Poké Memory is a hobby and fan project operated by Frazzled Productions Ltd (company no. 17258540), registered in England and Wales. It has no commercial purpose, no advertising, no social features, no user-to-user interaction, and no monetisation. The sole purpose of data processing is to deliver the cross-device spaced-repetition service and to improve it for the individual user.

### Purposes

1. Deliver the cross-device spaced-repetition service (synchronise review history, settings, streak).
2. Optimise FSRS scheduler weights for each user's individual retention target, using that user's own grade-event log.
3. Understand aggregate usage patterns via anonymous, cookieless analytics.
4. Receive and act on voluntarily submitted feedback to improve the service and resolve reported issues.
5. Send opt-in Web Push reminders to users who have enabled push notifications: a daily reminder when the user has cards due for review, and, for users who have separately opted in and hold an active review streak, a late-day reminder if they have not yet reviewed that day. (This purpose is recorded here retroactively for the existing daily reminder and extended for the late-day streak reminder added in #1950. Targeting reads the user's own streak dates and today's-review state to decide whether to send; it produces no profile and is not shared with any third party.)
6. Detect and fix faults, and monitor performance, via error monitoring and performance tracing (Sentry), for all users including guests. Recorded retroactively (#2103); legitimate interests in keeping the service working and secure.

### Data categories

All of the following apply to **authenticated users only** unless stated otherwise:

| Category | Details | Tables |
|---|---|---|
| Per-card FSRS parameters | Stability, difficulty, scheduled interval (days), reps, lapses, state, due date, last review, first seen - keyed by opaque UUID | `card_reviews` |
| Daily activity dates | Calendar dates on which at least one review was completed | `streak_days` |
| Grade events | Card type, subject identifier, grade chosen, entry date, precise timestamp | `grade_log` |
| User settings | Daily review limits, practice scope, theme, timezone, notification preferences (daily-reminder and streak-reminder opt-ins, reminder hour) | `user_settings` |
| Web Push subscription | Browser-issued push endpoint URL plus the `p256dh` and `auth` encryption keys, scoped to the account. Present only for users who have opted into push notifications. Used solely to deliver the reminders described in purpose 5. | `push_subscriptions` |
| Auth account record (held by Supabase Auth, not our own tables) | For OAuth accounts: the email address and display name returned by the provider, used only for authentication. For username/password accounts: the chosen username (also stored in `public.usernames`) plus a synthetic internal email that is not a real address and is never shown to the user or used to send mail. A username may be personal data if the user chooses a name that identifies them. | Supabase Auth schema; `public.usernames` |
| Aggregate analytics (all users) | Page path, referrer, country, device type, Core Web Vitals - no per-user identifier, no cookie | Vercel infrastructure |
| Error and performance diagnostics (all users) | Error reports (exception type, message, stack trace, browser/OS/device type, page URL, breadcrumbs) and a ~10% sample of performance traces. We do not attach names, email addresses, account identifiers or IP addresses, we do not send cookies or request bodies, and Session Replay is off (sample rates 0). With the SDK version currently in production, standard headers (User-Agent, Referer) and full page URLs including query strings can still be sent; stricter minimisation is enforced by the SDK upgrade in #2106. No card or review data. | Sentry, EU region (`ingest.de.sentry.io`, Germany), via a first-party tunnel at `/monitoring` |
| Feedback submissions | Category label, free-text message (up to 2,000 chars), page pathname, app version. user_id nullable (null for guest submissions). May contain personal data typed by the user. | `feedback` |

No special-category data (Article 9) is collected. For OAuth accounts, no name or email from the provider is written into our own tables. For username/password accounts, the chosen username is written to `public.usernames` (keyed by the user UUID) and may be personal data if the user selects a name that identifies them; the synthetic internal email used by Supabase Auth for those accounts is not a real address and is never shown to the user. Our review tables remain keyed only by the opaque UUID issued by Supabase Auth (the `feedback` table's user_id is nullable for guests).

As of #1369, the app UI renders in the user's chosen locale (`en` / `ja` / `zh-Hans` / `zh-Hant`), selected via the `poke-memory:locale` cookie. **This applies to all users - guest and authenticated** - since the locale cookie is set on explicit locale selection regardless of sign-in state. The chosen locale is a display preference only - it is **not personal data**: it carries no tracking payload, does not identify the individual, and is set only on an explicit user selection. It is recorded in the PECR storage inventory (`docs/cookies-pecr.md`) as a strictly-necessary functional-preference cookie, on the same footing as theme and timezone.

### Processors

| Processor | Role | Transfer mechanism |
|---|---|---|
| Supabase | Postgres database (authenticated-path review data, auth sessions) | DPA in place; SCCs / IDTA addendum |
| Vercel | Hosting, static asset delivery, aggregate analytics | DPA in place; SCCs / IDTA addendum |
| Discord | Bug-report triage notifications (processor / sub-processor) | DPA in place; SCCs / IDTA addendum |
| Sentry (Functional Software, Inc.) | Error monitoring and performance tracing (all users, including guests) | DPA (v5.1.0) accepted by the owner; EU-region storage (Germany, UK adequacy regulations for the EEA); Functional Software, Inc. is US-based, so remote access is covered by the DPA's Schedule 3 (EU-US Data Privacy Framework incl. UK Extension, falling back to EU SCCs Module 2 plus the ICO UK Addendum) |

GitHub and Google act as **independent controllers** for the OAuth authentication interaction only. They are not processors for our review data. The app itself never sees the OAuth token - the exchange is handled server-side by Supabase Auth.

The browser's Web Push service (Google FCM, Mozilla, or Apple, depending on the user's browser) acts as a **protocol-level conduit** for delivering push messages, not a sub-processor with access to message content: the notification payload is end-to-end encrypted under the Web Push standard using the subscription's `p256dh`/`auth` keys, so the push service relays ciphertext it cannot read. No new sub-processor is therefore added by the push feature.

### Retention

Authenticated-path data is retained for the lifetime of the account. Account deletion triggers a cascading delete on all rows associated with the user's UUID across `card_reviews`, `streak_days`, `grade_log`, `user_settings`, and `feedback`. The self-service "Reset all progress" action deletes review history immediately. There is currently no point-in-time backup (issue #298), so deletion is permanent and immediate.

Feedback rows are retained for 12 months from `created_at` and are then automatically deleted by a scheduled database function. For authenticated users, feedback rows are also deleted by cascade on account deletion.

Sentry error reports and performance traces are retained for Sentry's default of 90 days and then deleted automatically. They carry no user identifier, so they are not linked to any account and are not affected by account deletion.

---

## Step 3 - Consultation process

As a sole-operator service with no staff and no DPO (see Step 7), the consultation record for this DPIA is:

1. **Review of existing documentation.** The privacy notice (`app/privacy/page.tsx`), the Children's Code assessment (`docs/childrens-code-assessment.md`), and the PECR cookie position (`docs/cookies-pecr.md`) were reviewed in full. This DPIA draws on all three.

2. **Processor agreements reviewed.** The Supabase standard Data Processing Addendum, the Vercel Data Processing Agreement, and (added on the Sentry review, see R9) the Sentry Data Processing Addendum were reviewed. No material gap between the processing described in those agreements and the processing carried out by the app was identified.

3. **Codebase review.** The sync layer (`lib/sync/`), the Supabase schema and Row-Level Security policies (`db/migrations/`), the regression trigger (`card_reviews_reject_regression_trigger`), the feedback table schema and RLS policies, and the integration test suite (`lib/sync/integration/`) were reviewed to verify that the described technical controls are in place and functioning.

No external consultation (users, children's rights organisations, or supervisory authority pre-consultation) was sought, because no high-risk processing requiring pre-consultation under UK GDPR Article 36 was identified.

---

## Step 4 - Assess necessity and proportionality

### Necessity

Each data category is assessed against the purposes stated in Step 2:

- **FSRS parameters** (`card_reviews`): The spaced-repetition algorithm cannot schedule the next review without the prior review history. Each parameter (stability, difficulty, interval, reps, lapses, state, due date) is directly consumed by the FSRS scheduler. Necessary.
- **Streak dates** (`streak_days`): The streak feature requires a record of which dates had at least one review. No alternative representation can produce this without storing the dates. Necessary.
- **Grade-event log** (`grade_log`): Per-user FSRS-weight optimisation requires a time-ordered log of grade events; the optimiser reads raw grade sequences, not just aggregates. Necessary.
- **Settings** (`user_settings`): The cross-device service requires that the user's preferences (daily limits, practice scope, timezone, theme) are available on all devices. Necessary.
- **Auth account record** (Supabase Auth): Supabase Auth requires a profile record to identify the user on subsequent sign-ins. For OAuth accounts this is handled entirely by the provider exchange. For username/password accounts, the chosen username is the user-visible identifier (stored in `public.usernames`) and the synthetic internal email is a technical artefact required by Supabase Auth's data model, carrying no personal data. Necessary for authentication.
- **Aggregate analytics** (Vercel): Anonymous, cookieless usage data enables the controller to understand whether the service is reaching users and identify performance regressions. No individual is identified. Proportionate.
- **Error and performance diagnostics** (Sentry): Error reports and a ~10% trace sample are the minimum needed to detect and fix faults in production. We attach no name, email address, account identifier or IP address, send no cookies or request bodies, and Session Replay is off, so nothing beyond technical diagnostics (page address, standard browser details, breadcrumbs) is collected; stricter minimisation (no headers, no query parameters) follows with the SDK upgrade in #2106. Necessary and proportionate.
- **Feedback submissions** (`feedback`): Category, message, and pathname are consumed for issue investigation and service improvement. App version is included to contextualise reports against a specific release. user_id is included where present (authenticated users) to enable follow-up with the submitter if needed; it is nullable so guests can submit without being identified. The 2,000-character message limit prevents excessive data collection. Necessary.
- **Web Push subscription** (`push_subscriptions`): The endpoint and encryption keys are the minimum needed to deliver a push message to the user's browser; they exist only for users who opted in and are used for no other purpose. **Streak/review-recency read for targeting:** the late-day at-risk reminder cannot be scoped without knowing which users have an active streak and have not yet reviewed today, so the send job reads `streak_days` and today's `card_reviews.last_review` state for candidate users. No broader read is performed - no grade content, card difficulty, or review history beyond the dates needed to determine "active streak, not reviewed today, genuinely at risk". Necessary and minimal.

**Conclusion:** Every data category collected is necessary for its stated purpose. No data is collected for speculative future use.

### Proportionality

- **Minimum data:** Our own tables hold no name, no email, no precise location, no advertising identifier, no payment data, and no special-category data. The only identifier in our tables is the opaque UUID issued by Supabase Auth - not the user's email or display name.
- **Guest default:** Guest mode is the app's default state and stores nothing server-side. Data-minimisation is thus the default user experience, not an opt-in.
- **No third-party sharing for external purposes:** Review data is never shared with advertisers, data brokers, or third parties for those parties' own purposes.

### Lawful basis

Per the privacy notice (§5):

- **Cross-device sync and scheduler optimisation:** Contract performance - the user explicitly requests this service by choosing to sign in.
- **Aggregate analytics:** Legitimate interest - cookieless, no individual tracking, no cookie consent required (see `docs/cookies-pecr.md`).
- **Error monitoring and performance tracing (Sentry):** Legitimate interest in keeping the service working and secure. Purpose test: detecting and fixing faults. Necessity test: production faults cannot otherwise be observed across the range of browsers and devices in use. The balancing test is set out in the Sentry legitimate interests assessment below. No cookie or storage is used, so PECR is not engaged (see `docs/cookies-pecr.md`).
- **Feedback submissions:** Legitimate interest in improving the service and resolving reported issues. Feedback is voluntarily submitted; it is not used for profiling, marketing, or any purpose other than service improvement and issue resolution.
- **Push notification reminders (daily due-card reminder and late-day streak-at-risk reminder):** Legitimate interest - proportionate, opt-in, no-cost re-engagement messaging for a service the user actively uses and has enabled push for. It is not profiling for external purposes and is not shared with third parties. The user can withdraw at any time by turning off the relevant reminder toggle in Settings or by uninstalling the PWA / revoking the browser notification permission. The streak-at-risk reminder additionally suppresses itself when the user's streak is not genuinely at risk that day (e.g. a streak-protection token would cover the gap), so it does not manufacture false urgency (see also Standard 13 in `docs/childrens-code-assessment.md`).

### Legitimate interests assessment: Sentry error monitoring

- **Purpose:** detect, diagnose and fix faults and performance problems so the service keeps working and stays secure. This is a legitimate interest of the controller and of users.
- **Necessity:** production faults across many browsers and devices cannot otherwise be observed; users seldom report crashes. Only error reports and a ~10% trace sample are collected, with Session Replay off. Less intrusive alternatives (relying on user feedback alone) would not achieve the purpose.
- **Reasonable expectations:** crash and error reporting is a widely understood feature of web apps, and the privacy notice now discloses it (sections 2, 3, 4, 6, 7, 8 and the child-friendly summary). It applies to guests as well as signed-in users.
- **Children:** children under 13 are most likely to use guest mode and cannot opt out of error reporting. This is weighed under Children's Code Standard 1 (best interests) and Standard 8 (data minimisation) in `docs/childrens-code-assessment.md`: the data is technical only, carries no identifier and no card progress, and is not used for profiling, advertising or any purpose beyond fixing faults.
- **Mitigations:** no names, email addresses, account identifiers or IP addresses attached; no cookies or request bodies; Session Replay off; EU-region storage; DPA in place with a documented transfer mechanism; 90-day retention; the stricter minimisation in #2106.
- **Undocumented window:** Sentry ran in production for about 112 days before being documented. This assessment reviewed that window: the processing was technical diagnostics without names, email addresses or account identifiers, and no data-subject harm has been identified. Transparency was the gap, now closed by #2103.
- **Owner decision (Fraser, 29 September 2026): no guest opt-out toggle for error reporting.** Reasoning: reports carry no name, email, account identifier, IP address, cookies or request bodies; storage is in the EU; retention is 90 days; crash reporting is a reasonable expectation of a web app; and an opt-out would degrade the fixing of bugs, including those that affect children.
- **Outcome:** legitimate interests is appropriate; the balance favours processing given the minimisation and retention controls.

### Children's Code compatibility

`docs/childrens-code-assessment.md` assessed all 15 standards. The only outstanding gap is Standard 4 (transparency - no child-facing privacy summary), which is a documentation gap filed as a separate follow-up. The data-minimisation, default-guest, no-profiling, and no-detrimental-use requirements of the Code are met by the architecture.

### Data-subject rights

Self-service erasure ("Reset all progress", "Delete account") and portability ("Export progress") are available on the Settings page. These tools are described in the privacy notice (§9) and are functional. The Children's Code Standard 15 requirement for prominent, accessible rights tools is met.

---

## Step 5 - Identify and assess the risks

Risks are rated on a two-axis grid: **Likelihood** (Very Low / Low / Medium / High) × **Severity** (Very Low / Low / Medium / High).

| # | Risk | Likelihood | Severity | Combined rating |
|---|---|---|---|---|
| R1 | Unauthorised access to a user's review data via Supabase (e.g. RLS misconfiguration or compromised credentials) | Low | Medium | Low–Medium |
| R2 | Cross-border transfer of personal data outside the UK/EEA without adequate safeguards | Low | Medium | Low–Medium |
| R3 | Excessive data collection beyond what the SRS service requires | Low | Low | Low |
| R4 | A child under 13 creates an account and has personal data stored in Supabase | Low | Medium | Low–Medium |
| R5 | Data retained beyond its useful life after account deletion | Low | Low | Low |
| R6 | Anonymous analytics data re-identified and linked to an individual | Very Low | Low | Very Low |
| R7 | User types personal or sensitive data into the free-text feedback field | Low | Low | Low |
| R8 | Push targeting logic reads streak / last-review state to decide who to contact; a bug could over-notify, send a false "at risk" message, or leak streak state via notification content | Low | Low | Low |
| R9 | Error monitoring (Sentry) captures personal data, for example an identifier, IP address or URL parameter, or a payload containing card data, and sends it from guests as well as signed-in users | Low | Low | Low |

See Step 6 for the mitigation and residual-risk assessment for each row.

---

## Step 6 - Identify measures to reduce risk

### R1 - Unauthorised access via RLS misconfiguration or compromised credentials

**Existing controls:**

- Row-Level Security (RLS) is enforced at the Supabase Postgres layer for all four tables (`card_reviews`, `streak_days`, `grade_log`, `user_settings`). Policies restrict each row to the authenticated user whose UUID matches the row's `user_id` column.
- The regression trigger (`card_reviews_reject_regression_trigger`, introduced in migration 002 and extended in migrations 015, 016, and 017) blocks illegal writes at the database layer, independently of application-level validation.
- Integration tests (`lib/sync/integration/rls.test.ts`) verify that user A cannot read or write user B's rows. These tests run in CI on every PR that touches the sync surface.
- Supabase project credentials (service-role key, anon key) are stored as environment secrets, not in the codebase.

**Residual risk:** Low. The RLS controls are enforced at the database layer and are tested end-to-end in CI. No additional technical measure is currently required.

**Acceptable:** Yes.

---

### R2 - Cross-border transfer without adequate safeguards

**Existing controls:**

- Supabase operates under its standard Data Processing Addendum, which includes the EU Standard Contractual Clauses (SCCs) and a UK International Data Transfer Agreement (IDTA) addendum. Supabase primarily operates UK/EU infrastructure for customers in this region.
- Vercel operates under its Data Processing Agreement, which also includes SCCs / IDTA addendum.
- Sentry stores our data in its EU region (ingest host `ingest.de.sentry.io`, Germany) under a Data Processing Addendum accepted by the owner. Storage in Germany relies on the UK adequacy regulations for the EEA. However, Sentry (Functional Software, Inc., San Francisco) is a US company, so remote or support access from the US can be a restricted transfer. Verified against Sentry's published DPA v5.1.0 (29 May 2024), https://sentry.io/legal/dpa/ : Schedule 3 (Cross-Border Transfer Mechanisms) states that Sentry complies with the Data Privacy Framework (defined to include the UK Extension) for transfers from Europe to the US and, if that does not apply, the parties are bound by the EU SCCs (Decision 2021/914, Module 2, controller to processor, deemed signed on acceptance) with the ICO International Data Transfer Addendum (version B1.0) incorporated for UK transfers. Not verified here: Sentry's live DPF certification status on the Department of Commerce list; re-check at each review.
- The agreements were reviewed as part of Step 3. No gap between the processing described and the transfer mechanisms in place was identified.

**Residual risk:** Low. All sub-processors have adequate safeguards in place under UK GDPR Chapter V.

**Acceptable:** Yes.

---

### R3 - Excessive data collection

**Existing controls:**

- Data minimisation is enforced by design: our own tables hold no name, email, location, advertising identifier, or special-category data.
- The guest path collects nothing server-side by default.
- Each data field in the `card_reviews`, `streak_days`, `grade_log`, and `user_settings` tables is consumed directly by the FSRS scheduler, streak feature, optimiser, or settings sync - there are no "just in case" columns.
- The necessity analysis in Step 4 documents the justification for each field.

**Residual risk:** Very Low.

**Acceptable:** Yes.

---

### R4 - Child under 13 creates an account and has personal data stored

**Review trigger:** Own-account creation (username/password, #1671) was introduced in June 2026, firing the review trigger recorded at Step 7. This assessment is updated accordingly: the inherited 13+ age gate that OAuth provided does not apply to the username/password door, so severity rises from Low to Medium while likelihood remains Low.

**Existing controls:**

- The OAuth doors (GitHub, Google) still carry the providers' 13+ minimum age. The username/password door does not collect or verify age.
- The privacy notice (§11) explicitly directs under-13s to guest mode and asks them not to create an account or sign in.
- Guest mode, which stores nothing server-side, is the default experience and requires no account. Children of any age can use the app's full feature set without creating an account.
- The Children's Code uniform-standards approach is applied to all users regardless of age: minimal data, no profiling, no advertising, high-privacy defaults. The standard of care applied to any under-13 who does create an account is therefore the same as for all users, which satisfies the Code's requirement to treat the worst-case user as a child. The Children's Code assessment (`docs/childrens-code-assessment.md`) records this as the deliberate mitigation.
- `public.usernames` stores only the user-chosen username alongside the UUID. No age, name, location, or contact details are solicited at account creation.
- The absence of PITR (#298) means a parental erasure request results in immediate, permanent deletion.

**Residual risk:** Low–Medium. The inherited OAuth age gate is gone for the username/password door. Likelihood stays Low (guest mode is the default path, the privacy notice advises against signing in, and no age-relevant feature drives sign-up). Severity is Medium because authenticated accounts do store personal data (username, FSRS parameters) under the controller's responsibility, though that data is highly minimal and the uniform Children's Code standard applies.

**Acceptable:** Yes, on the basis that data minimisation and the uniform-standards approach adequately protect any child who does create an account, and that the privacy notice direction to guest mode is clear. A further review is required if magic-link (#1670) or email + password (#1673) sign-in is added, since those introduce real email collection.

---

### R5 - Data retained beyond useful life after account deletion

**Existing controls:**

- Account deletion triggers a cascading delete on all rows linked to the user's UUID across all four tables, via Postgres `ON DELETE CASCADE` foreign-key constraints.
- The "Reset all progress" action issues a direct delete of `card_reviews`, `streak_days`, `grade_log`, and `user_settings` rows without requiring account deletion.
- There is currently no point-in-time backup (issue #298), so deletion is permanent and immediate - there is no backup retention that could extend the data's life after erasure.

**Residual risk:** Low. The absence of a PITR backup means deleted data is not recoverable - which is both a retention-risk mitigation and a recovery-risk consideration. That trade-off is recorded in issue #298.

**Acceptable:** Yes.

---

### R6 - Anonymous analytics re-identified

**Existing controls:**

- Vercel Analytics and Speed Insights set no cookie and write nothing to `localStorage` or any other terminal-equipment storage (confirmed by code review - see `docs/cookies-pecr.md`).
- The analytics payload contains only page path, referrer, country (not city or more precise location), device type, and Core Web Vitals.
- No per-user identifier is transmitted. There is no joining key that would allow the analytics data to be linked to the `card_reviews` or other user tables in Supabase.
- Country-level aggregate data is not personal data under UK GDPR.

**Residual risk:** Very Low. Re-identification from cookieless, per-visit aggregate country-level data is not feasible in practice.

**Acceptable:** Yes.

---

### R7 - User types personal or sensitive data into the free-text feedback field

**Existing controls:**

- The feedback form displays an inline notice discouraging users from including personal information (name, email address, etc.) in their message.
- A server-side 2,000-character limit prevents large volumes of personal data being submitted inadvertently.
- Feedback rows are automatically deleted after 12 months by a scheduled database function.
- For authenticated users, feedback rows are deleted by cascade on account deletion.
- Feedback data is not used for profiling or marketing.
- Bug-report notifications to Discord: the message preview forwarded is capped at 500 characters, fetched by the Vercel route via the service-role client (keeping it out of pg_net request logs), sent to a private maintainer-only Discord channel, and processed under a DPA. No user identifier is included. The full message remains in Supabase within the existing RLS perimeter.

**Residual risk:** Low. Users may still include personal data despite the inline notice; the server-side truncation and automatic deletion schedule bound both the quantity and retention of any such data. The Discord preview is additionally capped at 500 characters and sent to a maintainer-only channel.

**Acceptable:** Yes.

---

### R8 - Push targeting reads streak / last-review state to decide who to contact

**Review trigger:** The late-day streak-at-risk reminder (#1950) was added, firing the "engagement mechanic / new push use case" trigger recorded at Step 7 and the equivalent trigger in `docs/childrens-code-assessment.md` (Standard 13). This risk row is added accordingly.

- The send job reads only the minimum needed: `streak_days` (which dates had a review) and today's `card_reviews.last_review` state for the candidate users, to determine "active streak, not reviewed today, genuinely at risk". No grade content, difficulty, or wider history is read.
- The reminder is **opt-in and default-off**, gated behind a separate, clearly-labelled Settings toggle in addition to the primary push permission, and is authenticated-path only (guests have no subscription).
- The notification body carries no personal data beyond a streak-length framing already accepted for the primary reminder; it never includes another user's data.
- The at-risk determination suppresses itself when the streak is not genuinely at risk (e.g. a streak-protection token would bridge the gap), so no false-urgency message is sent - an honesty control required by the Standard 13 re-check.
- The suppression and targeting logic (`lib/push/streakNudgePredicate.ts`) is covered by unit tests, and the new read RPCs by a real-RPC integration test, so a regression that over-notifies or mis-targets is caught in CI.

**Residual risk:** Low. The read is minimal and scoped, the feature is opt-in/default-off, and the targeting and honesty controls are tested. No additional measure is currently required.

**Acceptable:** Yes.

---

### R9 - Error monitoring (Sentry) captures more personal data than intended

**Background:** Sentry had been live in production for about 112 days (`NEXT_PUBLIC_SENTRY_DSN` set) before it was recorded here or in the privacy notice. This risk row, the processor entry, and the notice update (#2103) close that documentation gap. Because reports leave the browser for guests too, the guest-path statement that no data leaves the browser now applies to card and review data only.

**Existing controls:**

- Data minimisation by configuration: today, no names, email addresses, account identifiers or IP addresses are attached, no cookies or request bodies are sent, and Session Replay is off. The SDK version in production can still send standard headers (User-Agent, Referer), full page URLs including query strings, and breadcrumbs. The stricter policy (no headers, no query parameters) is enforced by the SDK upgrade PR #2106; this row should be re-read once that lands.
- Session Replay is off (sample rates 0); only error reports and a ~10% performance trace sample are sent.
- Reports contain technical diagnostics only (exception type, message, stack trace, browser/OS/device type, page address, breadcrumbs). Card progress and review history are not sent.
- Sentry sets no cookie and writes no `localStorage`; requests go through a first-party tunnel at `/monitoring` (see `docs/cookies-pecr.md`).
- EU region (Germany); DPA accepted by the owner; retention is Sentry's default of 90 days. Storage relies on UK adequacy regulations for the EEA; US-side access is covered by the DPA's DPF / SCCs plus UK Addendum mechanism (see R2).
- The privacy notice (sections 2, 3, 4, 6, 7 and 8) and the child-friendly summary disclose the processing, including for guests.

**Residual risk:** Low. Exception messages, breadcrumbs or URL query strings could in principle echo a value the user typed, but the absence of identifiers, the planned stricter minimisation (#2106), and 90-day retention bound both the likelihood and the impact. Because reports carry no identifier, individual reports usually cannot be located for access or erasure requests; they expire after 90 days and are unaffected by account deletion.

**Acceptable:** Yes.

---

### Overall conclusion

No residual risk identified in this assessment is rated as unacceptable. No further technical or organisational measures are currently required. The processing described in this DPIA is proportionate and appropriate for the service.

---

## Step 7 - Sign off and record outcomes

### DPO requirement

Under UK GDPR Article 37, appointment of a Data Protection Officer is mandatory only for:

(a) Public authorities or bodies (except courts acting in their judicial capacity).  
(b) Controllers or processors whose core activities consist of processing operations which, by virtue of their nature, scope, or purposes, require regular and systematic monitoring of data subjects on a large scale.  
(c) Controllers or processors whose core activities consist of processing special-category data on a large scale, or personal data relating to criminal convictions and offences.

None of these conditions apply to Poké Memory:

- It is not a public authority.
- Its core activity is delivering a spaced-repetition study tool, not systematic monitoring. The FSRS scheduler adapts review timing for the individual user's own benefit - it is not monitoring in the Article 37(1)(b) sense, and it is not at any plausible scale that would trigger the large-scale threshold.
- No special-category data is processed.

**Conclusion:** No DPO is appointed, and none is required under UK GDPR Article 37. This is a hobby project operated by a sole individual.

### ICO registration

| Field | Value |
|---|---|
| ICO data protection fee | Paid 2026-06-03, Tier 1, ~£52/yr direct debit |
| Public register number | ZC165261 (Frazzled Productions Ltd) |
| Internal application reference | ICO:00014322369 |

The registration number ZC165261 appears on the public ICO register and is cited in the privacy notice (§1). The internal application reference and payment credentials are not published anywhere in this codebase.

### Sign-off

| Field | Value |
|---|---|
| Approved by | Frazzled Productions Ltd (company no. 17258540) - privacy@pokememory.com |
| Date | June 2026 |
| Reference | Issues #698, #721, #1623, #1672 |
| Outcome | No residual risk is rated above Low–Medium. No unacceptable risks identified. No ICO pre-consultation required. ICO data protection fee paid; registration number ZC165261. |

### Review triggers

This DPIA should be reviewed and updated if any of the following occur:

- A new category of personal data is collected (e.g. age data, payment data, precise location).
- Social, community, or user-to-user features are added.
- Advertising, marketing, affiliate, or behavioural-profiling integrations are added.
- Sentry configuration changes so that it collects user identifiers, IP addresses, request data, or Session Replay, or its region or retention changes.
- A new push-notification use case reads an existing data category for a new targeting purpose. (Fired by #1950: the late-day streak-at-risk reminder reads `streak_days` / `card_reviews.last_review` for targeting. Purposes, data categories, lawful basis, and R8 were updated accordingly.)
- Own-account creation was added in #1671 (username/password, June 2026): this trigger fired and R4 was updated accordingly. A further review is required if magic-link (#1670) or email + password (#1673) sign-in is added, since those introduce real email collection.
- A new sub-processor is engaged. (Fired retroactively for Sentry, #2103: processor entry, purpose 6, lawful basis, R2 and R9 updated.)
- A significant security incident occurs affecting the confidentiality, integrity, or availability of user data.
- The Children's Code assessment (`docs/childrens-code-assessment.md`) is updated to reflect a changed risk profile.
- The locale offering is expanded beyond the four supported locales, or a new processing purpose is introduced in connection with locale data.

---

*Cross-references: `docs/childrens-code-assessment.md` (Children's Code scoping), `docs/cookies-pecr.md` (PECR cookie position), `app/privacy/page.tsx` (privacy notice).*
