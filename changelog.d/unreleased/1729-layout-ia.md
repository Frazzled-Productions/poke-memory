---
kind: minor-bump
issues: [1729, 1730, 1731, 1732, 1733, 1734, 1735]
---

Cross-page layout and information-architecture consistency pass.

- **Practice (#1730)**: added a visually-hidden `<h1>` ("Practice") so screen-reader users have a top-level heading on the app's primary route.
- **Journey (#1731)**: restructured ~14 flat `<h2>` sections into three labelled super-sections (Your progress / Collection / Breakdown). Guest sign-up nudge moved to immediately after the Trainer Card. Content-section headings demoted to `<h3>`. New catalogue keys in all four locales.
- **Stats (#1732)**: moved the "Restore from cloud" force-pull action to Settings ("Data & backup"). Stats now shows a contextual link to /settings instead. Collapsed `lg:max-w-6xl` to `max-w-3xl`. Heading sizes normalised via `SectionHeading`.
- **i18n (#1733)**: translated the What's-new page (heading, subtitle, section-kind labels, localised dates) and the biome stats strip (visible labels and sr-only `<dt>` labels). `WhatsNewIndicator` visible text now uses `t("nav.whatsNew")`.
- **Detail page (#1734)**: locked species `<h1>` now shows the zero-padded national-dex number (e.g. "#025") instead of "???" for a meaningful accessible label. Added `generateMetadata` (number-only for server/shares; client updates to the localised name once the species is learned).
- **Foundation (#1735)**: shared `PageShell` component (outer `<main>` + inner max-width container, width tiers: wide/reading/narrow). Added `pageTitle`, `sectionHeadingLg`, `sectionHeading` class-name tokens. `SectionHeading` component emits the real semantic heading element. All in-scope pages migrated to `PageShell`.
