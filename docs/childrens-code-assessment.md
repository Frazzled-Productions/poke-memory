# Children's Code (Age Appropriate Design Code) assessment

**Assessment date:** May 2026
**Related issue:** #699
**Reviewed against:** `app/privacy/page.tsx`, the Privacy section of `AGENTS.md`, and `docs/cookies-pecr.md`.

## Summary

The ICO's *Age Appropriate Design Code* ("Children's Code") **applies** to Poké Memory. A Pokémon-themed learning app is likely to be accessed by children in the UK, and "likely to be accessed" — not "directed at" — is the statutory trigger.

The good news: Poké Memory's existing architecture already satisfies the substance of most of the 15 standards. It collects minimal data, runs no advertising or marketing profiling, sets no tracking cookies, defaults to a guest mode that stores nothing server-side, and gates all server-side data collection behind a third-party account (GitHub or Google) that itself enforces a 13+ minimum age.

The gaps are about **transparency and documentation**, not data practices: the privacy notice is not written in age-appropriate language, there is no child-facing summary, and a handful of standards have never been explicitly recorded as design decisions. None of the gaps are data-flow changes. They are addressed below — trivial ones are noted as in-scope for the issue #699 PR, larger ones are filed as follow-ups.

## Does the Code apply?

### The "likely to be accessed by children" test

The Children's Code applies to "information society services likely to be accessed by children" in the UK. The ICO is explicit that this is a **lower bar than "directed at" or "intended for" children**. A service is in scope if the possibility of child access is "more probable than not", judged on:

- **The nature and content of the service, and whether it has appeal to children.** Poké Memory is built entirely around the Pokémon franchise — a property with very strong, well-documented appeal to children. The core activity (learning Pokémon names and evolutions) is squarely the kind of thing children do for fun.
- **The way the service is accessed and any measures to prevent children gaining access.** The app is a free, public website with no age gate on entry and no payment barrier. Guest mode requires no account at all. There is nothing preventing a child from using it.
- **Market research, current evidence on user base, and the intended user base.** Poké Memory is a personal/hobby project with no formal market research, but the franchise's child appeal is not in dispute.

**Conclusion:** Poké Memory is **likely to be accessed by children** and is therefore **in scope** for the Children's Code. The honest read is that this is not a borderline call — a Pokémon learning app is close to a textbook example of a service caught by the "likely to be accessed" test, even though the privacy notice (§11) states the app is "not directed at children under 13". "Not directed at" does not take a service out of scope; only effective measures to prevent child access would, and Poké Memory has none.

### Interaction with the under-13 sign-in position

The privacy notice currently says the app is "not directed at children under 13" and asks under-13s to use guest mode rather than signing in. That remains a sensible position for the **authenticated** path, because:

- Sign-in requires a GitHub or Google account. Both providers' terms set a **minimum age of 13** (16 in some jurisdictions). A child under 13 should not hold either account.
- This means server-side personal-data processing is gated behind a third-party account that is itself age-restricted. The app never operates an under-13 account on its own infrastructure.

But this does **not** remove the app from the Children's Code's scope, because:

- The Children's Code covers children **up to 18**, not just under-13s. A 13–17-year-old can legitimately hold a GitHub/Google account and sign in. The Code's standards apply in full to them.
- The **guest path** is open to users of any age, including under-13s, and is the default experience. Guest mode is where most child use will happen.

So the assessment must treat both paths as in scope, with the design analysis below covering guest users of all ages and authenticated users aged 13–18.

## The 15 standards

The Code's 15 standards are assessed below. Each is marked **Met**, **Met (record only)** — where the practice is already correct but had never been written down as a deliberate decision — or **Gap**.

### 1. Best interests of the child

**Met.** The service's purpose is educational — helping users learn and remember Pokémon names and evolutions through spaced repetition. It contains no commercial pressure, no advertising, no in-app purchases, and no social features that could expose a child to other users. The design does not work against a child's wellbeing, development, or rights.

### 2. Data protection impact assessments (DPIAs)

**Met (record only).** This document, together with the privacy notice and `docs/cookies-pecr.md`, is **preparatory evidence that will inform a future formal DPIA** for the children's-data angle — it is not itself a DPIA and does not claim to substitute for one. A formal ICO DPIA needs explicit fields this document does not provide: a necessity-and-proportionality test, risks rated individually by likelihood and severity, a mitigation recorded against each risk, and DPO sign-off where applicable. What this assessment does establish is that the processing is low-risk: minimal data, no profiling, no advertising, RLS-isolated per-user storage, and a guest path that processes nothing server-side. The standalone formal DPIA is filed as follow-up issue #721; no high-risk processing has been identified that would make one legally mandatory, but it is good practice for a service in scope of the Children's Code.

### 3. Age-appropriate application

**Met, with one transparency gap.** The app applies the same high-privacy, low-data design to all users regardless of age — it does not attempt to estimate age and vary the experience. For a service of this risk profile the ICO accepts applying the standards to **all** users as a valid alternative to age assurance, and that is what Poké Memory does. The only age-related distinction is the sign-in age gate inherited from GitHub/Google. The gap is purely that the privacy notice is not written in language a child can understand (see Standard 4).

### 4. Transparency

**Gap.** The privacy notice at `app/privacy/page.tsx` is accurate and thorough but is written in adult, semi-legal register (lawful bases, sub-processors, PECR, IDTA). The Children's Code requires privacy information to be presented in a way children can understand — typically a concise, plain-language summary at the point it is needed, suited to the age of the audience. There is currently no child-facing summary. This is the most substantive gap and is filed as a follow-up issue (see below).

### 5. Detrimental use of data

**Met (record only).** Data is used only to schedule spaced-repetition reviews, compute the user's own statistics and streak, and optimise the FSRS scheduler weights for that same user. It is never used in any way that the ICO's guidance or other regulatory codes identify as detrimental — no advertising, no behavioural targeting, no sale or sharing of data with third parties for their own purposes.

### 6. Policies and community standards

**Met.** Poké Memory has no community or social surface — no comments, no messaging, no user-to-user interaction, no user-generated content. The published terms relevant to data (the privacy notice) reflect what the app actually does, which is the substance of this standard. There are no community standards to uphold because there is no community.

### 7. Default settings

**Met (record only).** Settings default to high privacy. Guest mode is the default and stores nothing server-side. No data leaves the device until the user makes a deliberate choice to sign in. There is no setting that, by default, exposes a child's data more widely — there are no sharing, visibility, or discoverability settings at all. The default is the most private state the app can be in.

### 8. Data minimisation

**Met.** This is a clear strength. The app collects only what the spaced-repetition service needs: per-card FSRS parameters, daily review dates, a grade-event log, and user settings — all keyed to an opaque Supabase user UUID. Our own tables hold no name, no email, no profile data. No precise location, no advertising identifiers, no payment data. Guest users have nothing collected server-side at all. See privacy notice §3.

### 9. Data sharing

**Met (record only).** The app does not share personal data with third parties for those parties' own purposes. Supabase and Vercel are processors under a DPA, acting only on the app's instructions. GitHub/Google act as independent controllers **only** for the authentication interaction the user themselves initiates — the app discloses no review or progress data to them. There is no analytics, ad-tech, or data-broker sharing. Vercel Analytics receives only aggregate, anonymous metrics with no per-user identity.

### 10. Geolocation

**Met (record only).** The app collects no geolocation data. It does not request the geolocation permission, does not use device location, and exposes no location to other users (there are no other users). Vercel Analytics records a coarse country at aggregate level only, not tied to any individual — this is not personal geolocation tracking.

### 11. Parental controls

**Met (not applicable).** Parental controls are required where a service provides them, and where it monitors a child it must make that visible. Poké Memory does neither — it has no parental-control feature and does not monitor or track the child's activity beyond storing the child's own review progress for the child's own use. There is nothing here that a parental control would govern. No action needed; recorded for completeness.

### 12. Profiling

**Met (record only).** This standard requires profiling to be **off by default**. Poké Memory does no profiling in the Code's sense. The FSRS scheduler does adapt review timing to the individual's performance, but it is a study aid operating only on that user's own learning data, for that user's own benefit — it is not used to make decisions *about* the child, to target content, or to build a behavioural profile for any external purpose. There is no advertising or content-recommendation profiling anywhere in the app.

### 13. Nudge techniques

**Met, worth keeping under review.** The app uses no dark patterns to push children toward lower-privacy choices or to extend engagement against their interests. The streak counter and daily review limits are study-habit features common to spaced-repetition tools, and the daily review cap actively works *against* over-engagement by design. There is no nudging toward sign-in, toward disclosing more data, or toward weakening privacy settings. This standard should be re-checked whenever engagement-oriented features (notifications, reminders, reward mechanics) are added.

### 14. Connected toys and devices

**Met (not applicable).** Poké Memory is a website. It is not a connected toy or device and has no associated hardware. Recorded for completeness.

### 15. Online tools

**Met.** Children must be given prominent, accessible tools to exercise their data rights. The privacy notice §9 sets out the full set of UK GDPR rights, and the app provides self-service *Reset all progress* and *Export progress* controls on the Settings page that let a user erase or download their data without contacting anyone. The residual gap is that these are described in adult language — the child-facing summary follow-up (Standard 4) should also point children at these tools in plain terms.

## Standards summary

| # | Standard | Status |
|---|---|---|
| 1 | Best interests of the child | Met |
| 2 | Data protection impact assessments | Met (record only) — formal DPIA filed as follow-up |
| 3 | Age-appropriate application | Met |
| 4 | Transparency | **Gap** — no child-facing privacy summary |
| 5 | Detrimental use of data | Met (record only) |
| 6 | Policies and community standards | Met |
| 7 | Default settings | Met (record only) |
| 8 | Data minimisation | Met |
| 9 | Data sharing | Met (record only) |
| 10 | Geolocation | Met (record only) |
| 11 | Parental controls | Met (not applicable) |
| 12 | Profiling | Met (record only) |
| 13 | Nudge techniques | Met |
| 14 | Connected toys and devices | Met (not applicable) |
| 15 | Online tools | Met |

## COPPA (US equivalent) — high-level view

The US *Children's Online Privacy Protection Act* (COPPA) is narrower than the Children's Code in two key respects:

- It protects **children under 13 only** (the Children's Code covers under-18s).
- It bites on operators of services **directed to children**, or on operators with **actual knowledge** that they are collecting personal information from a child under 13.

High-level position for Poké Memory:

- **Guest path:** COPPA's core obligations attach to the *collection* of personal information from a child. The guest path collects no personal information server-side — review state never leaves the device. There is no collection for COPPA to regulate.
- **Authenticated path:** Sign-in requires a GitHub or Google account, and both providers require account holders to be **13 or older**. The app therefore has no reasonable basis to expect — and gains no actual knowledge of — under-13 sign-ins. Personal information is collected only after an age-gated third-party authentication. The privacy notice §11 additionally states the app is not directed at under-13s and asks them not to sign in.
- **"Directed to children":** The FTC's multi-factor test (subject matter, visuals, child-oriented activities, etc.) could plausibly weigh toward "directed to children" given the Pokémon theme — the same honest read applies as for the Children's Code's "likely to be accessed" test. But because the only path that collects personal information is gated behind an age-restricted 13+ account, the practical COPPA exposure is low: there is no mechanism by which the app knowingly collects personal information from an under-13.
- **Vercel Analytics:** Analytics runs for all visitors regardless of path or age, so it would collect country-level aggregate metrics from any US-based under-13 who uses the app. It is cookieless and gathers no per-user identifier, no precise location, and no contact details — the data is aggregated and not tied to an individual. COPPA's "personal information" definition turns on data collected from a child that could identify or contact them; aggregate, cookieless country counts do not meet that bar, so Analytics does not bring the app within COPPA's collection trigger. It is noted here for completeness rather than as a gap.

**Conclusion:** COPPA exposure is low and is adequately mitigated by the existing design — guest mode collects nothing, and authenticated collection sits behind a 13+ age gate. No COPPA-specific changes are recommended at this time. This position should be revisited if the app ever adds its own (non-OAuth) account creation, since that would remove the inherited age gate.

## Outcome and follow-ups

**The Children's Code applies, and Poké Memory's data practices already satisfy the substance of all 15 standards.** The only genuine gap is **transparency (Standard 4)** — the privacy notice is not written in age-appropriate language and there is no child-facing summary.

Follow-up items (filed as separate issues, `priority:later`):

1. **Child-facing privacy summary (Standard 4 / 15).** Add a concise, plain-language summary of what data the app collects and what choices the user has, written so a child can understand it, surfaced at or near the privacy notice. Should also point children at the *Reset all progress* and *Export progress* self-service tools in plain terms.
2. **Formal standalone DPIA (Standard 2).** Produce a formal DPIA document for completeness. Not legally mandatory given the low-risk, minimal-data processing identified here, but good practice for a service in scope of the Children's Code.

No follow-up is required for COPPA. No data-flow or architecture changes are required by this assessment — the gaps are documentation and copy only.

### Standard 4 (Transparency) — full-UI-translation rollout (#1369)

As of #1369, the app UI **and** the first-visit onboarding modal are machine-translated into Japanese (`ja`), Simplified Chinese (`zh-Hans`), and Traditional Chinese (`zh-Hant`) in addition to English. Because the onboarding modal is the first child-facing surface a new user meets, the quality of its translated copy is directly relevant to the transparency standard.

**No in-product mitigations shipped with #1369.** The following are planned but not yet implemented:

- **#1349** — a "machine-translated, feedback welcome" banner in-app and inside the onboarding modal (`priority:later`; not yet shipped). Until this lands, there is no in-product signal telling users that non-English copy is machine-generated.
- A "preview" label on the locale picker to signal that non-English locales are not yet human-reviewed (not yet implemented).

Until the onboarding copy is human-reviewed, the non-English locales are treated as **"preview" quality on the onboarding surface**.

**Required before GA on the child-facing onboarding surface:** human review of the onboarding copy (roughly 200 words per locale) by a fluent speaker of each locale, to confirm the plain-language transparency wording reads correctly and is age-appropriate. This is tracked as **#1376**. If `ChildFriendlySummary` (the child-facing summary on the privacy page) is machine-translated into any of these locales, it falls within the same human-review scope, since it is the dedicated Standard 4 / 15 child-facing surface.

No data-flow change is involved — locale selection is a display preference only (see `docs/dpia.md` and `docs/cookies-pecr.md`). The follow-up is copy quality, not data practice.

---
**Best-effort machine review pass (2026-05-30, #1376)**

A best-effort review of the onboarding modal (`onboarding` namespace in `messages/ja.json`, `messages/zh-Hans.json`, and `messages/zh-Hant.json`) was applied on 2026-05-30 as part of issue #1376. This pass addressed obvious register and clarity issues against the Standard 4 checklist (reading age, removal of technical jargon, sentence simplicity, neutralising any pressure framing). It was not a native-speaker review and does not constitute human review for the purpose of Standard 4 compliance.

**GA-quality native review of the onboarding copy remains outstanding.** Until fluent speakers of Japanese, Simplified Chinese, and Traditional Chinese have reviewed the `onboarding` namespace (approximately 200 words per locale) and confirmed it reads as age-appropriate for a child audience, issue #1376 stays open and the following in-product mitigations remain in place:

- The "machine-translated, feedback welcome" banner (`banner.machineTranslated`) in-app and inside the onboarding modal (#1349).
- The "preview" label on the locale picker.

The Standard 4 status in the table above remains **Gap** for non-English locales until the native review is completed.

---

This assessment should be revisited if any of the following change:

- The app adds its own account creation (removing the inherited 13+ age gate).
- The app UI is translated into a new locale, or machine-translated copy is replaced by human-reviewed copy.
- Social, community, or user-to-user features are added.
- Advertising, marketing, affiliate, or behavioural-profiling integrations are added.
- Engagement mechanics (push notifications, reminders, reward loops) are added — re-check Standard 13.
- Geolocation or any new category of personal data starts being collected.
