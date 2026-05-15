# PECR cookie position

**Decision date:** May 2026  
**Related issue:** #187 (research), #674 (formal record)

## Summary

No consent banner is required. Every item of client-side storage used by Poké Memory qualifies for the strictly-necessary exemption under the UK Privacy and Electronic Communications Regulations 2003 (PECR). This document records the basis for that position.

## Storage inventory

| Storage item | Path | Purpose | Classification |
|---|---|---|---|
| `poke-memory:*` keys in `localStorage` | Guest + signed-in | SRS card state, settings, superuser QA flags, theme pre-paint | Strictly necessary — without this the app cannot function |
| Supabase Auth session cookie (HTTP-only JWT) | Signed-in only | Keeps the user authenticated across requests | Strictly necessary — set by `@supabase/ssr`; not present in guest mode |
| Vercel Analytics / Speed Insights | All users | Aggregate, anonymous page-view metrics and Core Web Vitals | **No cookie set, no `localStorage` write** — client-side scripts that write nothing to terminal-equipment storage; PECR Regulation 6 not engaged |

The inline `<script>` in the root layout reads `poke-memory:settings:v1` from `localStorage` before first paint solely to apply a saved colour theme without a visible flash. This is incidental to storage that is already strictly necessary (the settings entry itself); it does not constitute a separate storage act.

## PECR analysis

PECR Regulation 6 requires prior consent before storing or accessing information on a user's terminal equipment **unless** the storage is "strictly necessary" for the provision of a service explicitly requested by the subscriber or user.

**Local storage (SRS state, settings):** The user explicitly requests the spaced-repetition service. Persisting review state in `localStorage` is strictly necessary to deliver that service in guest mode — without it, all progress is lost on navigation. This is the canonical strictly-necessary exemption.

**Supabase Auth cookie:** The cookie is set only when a user explicitly signs in. An authentication session cookie is the textbook example of a strictly-necessary cookie; it does not persist after sign-out and carries no tracking payload.

**Vercel Analytics / Speed Insights:** `@vercel/analytics` v2 and `@vercel/speed-insights` inject a client-side `<script>` tag that runs in the browser. They set no cookie and write nothing to `localStorage` or any other terminal-equipment storage. PECR Regulation 6 is not engaged because no information is stored on or retrieved from the user's terminal equipment.

## Conclusion

Because no non-essential storage is in use, no consent mechanism (banner, opt-in, or opt-out) is required under PECR. This position was confirmed by code review of `app/layout.tsx` and inspection of the `@vercel/analytics` and `@vercel/speed-insights` distribution bundles.

The position should be reviewed if any of the following change:

- A third-party script or widget is added that sets its own cookies.
- Vercel Analytics introduces cookie-based tracking in a future version.
- Any advertising, affiliate, or social-sharing integration is added.
- A persistent "remember me" or preference cookie is added outside the existing `localStorage` settings entry.
