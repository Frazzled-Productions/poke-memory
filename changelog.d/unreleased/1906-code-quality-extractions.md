---
kind: changed
issue: 1906
---
- Extracted four duplicated code patterns into single-source helpers (weekly code-quality digest #1906, items 2-5): the persisted-queue push + session-fallback engine shared by the sync retry and reconnect hooks (`lib/sync/pushWithFallback.ts`), the `getUser()` + 401 guard used by authenticated API routes (`lib/auth/requireAuth.ts`), the JSON-body parse guard used by POST API routes (`lib/api/parseJsonBody.ts`), and the inline section-heading Tailwind literal now routed through `sectionHeadingSm`. No behaviour change.
