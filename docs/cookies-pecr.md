# PECR cookie position

**Decision date:** May 2026  
**Related issue:** #187 (research), #674 (formal record)  
**Revised:** November 2026 for the move to Cloudflare (#2393): the Better Auth session cookie replaces Supabase Auth's, and Cloudflare Web Analytics replaces Vercel Analytics and Speed Insights. Describes the service after the cutover.

## Summary

No consent banner is required. Every item of client-side storage used by Poké Memory qualifies for the strictly-necessary exemption under the UK Privacy and Electronic Communications Regulations 2003 (PECR). This document records the basis for that position.

## Storage inventory

| Storage item | Path | Purpose | Classification |
|---|---|---|---|
| `poke-memory:*` keys in `localStorage` | Guest + signed-in | SRS card state, settings, superuser QA flags, theme pre-paint | Strictly necessary - without this the app cannot function |
| `poke-memory:locale` cookie | Guest + signed-in | Persists the chosen app UI language (`en` / `ja` / `zh-Hans` / `zh-Hant`); set only on an explicit user selection; ~1 year expiry | Strictly necessary - functional preference like theme/timezone; no tracking payload, does not identify the individual |
| `better-auth.session_token` (HTTP-only, signed session token) | Signed-in only | Keeps the user authenticated across requests | Strictly necessary - set by Better Auth on sign-in; not present in guest mode. During a GitHub or Google sign-in Better Auth may also set short-lived sign-in-flow cookies (OAuth state), strictly necessary for the same reason |
| Sentry (error monitoring and performance tracing) | All users | Error reports and a ~10% performance trace sample, sent via a first-party tunnel at `/monitoring` | **No cookie set, no `localStorage` write** - the SDK stores nothing on the device and Session Replay is off; PECR Regulation 6 not engaged |
| Cloudflare Web Analytics | All users (production builds with a beacon token only) | Aggregate, anonymous page-view metrics and page-load performance | **No cookie set, no `localStorage` write** - a client-side script that writes nothing to terminal-equipment storage; PECR Regulation 6 not engaged |
| Daily app-open count (`POST /api/event`) | All users | One beacon per page session with two fixed buckets, counted per UTC day in our own database | **No cookie set, no `localStorage` write** - reads only what `FunnelTracker` already reads, sends a request, stores nothing on the device; PECR Regulation 6 not engaged |

The inline `<script>` in the root layout reads `poke-memory:settings:v1` from `localStorage` before first paint solely to apply a saved colour theme without a visible flash. This is incidental to storage that is already strictly necessary (the settings entry itself); it does not constitute a separate storage act.

## PECR analysis

PECR Regulation 6 requires prior consent before storing or accessing information on a user's terminal equipment **unless** the storage is "strictly necessary" for the provision of a service explicitly requested by the subscriber or user.

**Local storage (SRS state, settings):** The user explicitly requests the spaced-repetition service. Persisting review state in `localStorage` is strictly necessary to deliver that service in guest mode - without it, all progress is lost on navigation. This is the canonical strictly-necessary exemption.

**Better Auth session cookie:** The cookie is set only when a user explicitly signs in. An authentication session cookie is the textbook example of a strictly-necessary cookie; it does not persist after sign-out and carries no tracking payload.

**Locale cookie (`poke-memory:locale`):** First set in #1260; added to this inventory in #1378. This cookie was a pre-existing gap in this inventory, recorded here for completeness. It persists the user's chosen app UI language and is written only when the user explicitly selects a locale. It is a functional-preference cookie in the same class as theme and timezone: it carries no tracking payload and does not identify the individual. The strictly-necessary exemption applies because the user explicitly requested the localised experience, and remembering that choice is necessary to deliver the service the user asked for.

**Cloudflare Web Analytics:** the root layout adds Cloudflare's `beacon.min.js` only when `NEXT_PUBLIC_CF_BEACON_TOKEN` is set at build time. Cloudflare documents it as using no client-side state: it sets no cookie and writes nothing to `localStorage` or any other terminal-equipment storage. PECR Regulation 6 is not engaged because no information is stored on the user's terminal equipment.

**Daily app-open count:** `FunnelTracker` reads the `localStorage` keys it already needs (the strictly-necessary SRS state above) to pick two coarse buckets, and sends them with `navigator.sendBeacon` to our own `/api/event`. Nothing new is stored on the device, and the reads are of storage the app keeps for its own function; the count itself is kept server-side per UTC day with no identifier (`docs/dpia.md`, R6).

**Sentry (error monitoring):** Sentry is live in production and was recorded here retroactively (#2103). The SDK sets no cookie and writes nothing to `localStorage` or any other terminal-equipment storage, and Session Replay (which would otherwise observe the page) is off. Reports are sent through a first-party tunnel route at `/monitoring` on our own domain, which forwards them to Sentry's EU region. The tunnel is a request path, not storage on or access to the user's terminal equipment, so it is not a PECR Regulation 6 issue; it also means the requests are not blocked as third-party traffic and remain visible in our own routing. Data protection aspects (legitimate interests, 90-day retention, minimisation) are in `docs/dpia.md` (R9).

## Conclusion

Because no non-essential storage is in use, no consent mechanism (banner, opt-in, or opt-out) is required under PECR. This position was confirmed by code review of `app/layout.tsx` and, before the November 2026 move, inspection of the `@vercel/analytics` and `@vercel/speed-insights` distribution bundles; Cloudflare Web Analytics and the Better Auth cookies are to be checked on the preview Worker before the cutover (#2393).

The position should be reviewed if any of the following change:

- A third-party script or widget is added that sets its own cookies.
- Cloudflare Web Analytics introduces cookie-based tracking, or Cloudflare features that set their own cookies (for example bot protection) are turned on for the app's domain.
- The Sentry SDK is upgraded or reconfigured so that it stores anything on the device (cookies, `localStorage`, `sessionStorage`) or enables Session Replay.
- Any advertising, affiliate, or social-sharing integration is added.
- An additional preference cookie beyond `poke-memory:locale` is added outside the existing `localStorage` settings entry.
