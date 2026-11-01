## Why

Background Sync replay is the only way grades leave the device once every tab is closed, and no test
runs it: the handler lives inside the `sync` listener in `app/sw.ts`, which is outside unit coverage,
and `lib/sync/swReplay.test.ts` checks a copy of its branches. It also retries requests that cannot
succeed: `/api/sync` answers 400 for a bad payload and 409 for a structural error, and says not to
retry a 409, but the handler rejects on both, so the browser sends the same request again until it
gives up. No user harm is proven; this came from the 1 November audit (ops #375, item 8).

Fixes: #2209

## What Changes

- The handler moves to `lib/pwa/swReplay.ts` as `replayPendingGrades`, with clients, `fetch` and queue
  access passed in, as `lib/pwa/swIdb.ts` did. `app/sw.ts` keeps a thin `sync` listener.
- A 400 or 409 resolves the sync event and keeps the queue. Every other outcome stays as it is.
- New `lib/pwa/swReplayHandler.test.ts` runs the real handler, with a real `MessageChannel`.
- New capability `background-sync-replay`: a baseline of how replay behaves today, plus the one new
  requirement.
- `docs/sync.md` names the new home and the new outcome.

## Also touches

Evidence from the `blast-radius` run on 2 November 2026 against `origin/qa` at `d2456f44`: the real
`app/sw.ts` of `qa` and of this change, bundled with esbuild and driven through its `sync` listener in
Node with `fake-indexeddb`, for 200, 401, 403, 400, 409, 502, a network error, an empty queue and a
client ACK. Only 400 and 409 differ.

- **Push notifications and the service worker (offline):** behaviour change for 400 and 409 only. The
  worker's bytes change, so browsers pick it up as a normal update. `SW_CACHE_VERSION` is unchanged,
  because no cache is touched. The IndexedDB key and row format are unchanged.
- **Cloud sync and Supabase migrations (both projects):** no migration and no change to `/api/sync`.
  The app's own push is unchanged: on a 409 it keeps the queue and shows the structural-error banner
  (`lib/sync/useSyncOnUnload.ts:143`). On the next open it pushes its localStorage copy
  (`lib/sync/usePerGradeSync.ts:507`), so a resolved replay does not hide the failure for long.
- **Guest mode (localStorage):** no change. Guests write no queue, so an empty queue resolves as before.
- **Superuser mode and QA-seed scenarios:** no change. A superuser session writes no queue, so the
  worker sees an empty one.
- **Sign-in:** no change. 401 and 403 behave as before.
- **Review and quiz screens (home), Pokédex, Pasture, Stats, Journey, Settings, What's new:** no change.
  None of them reads the handler.
- **Locales (en, ja, zh-Hans, zh-Hant, pseudo-locale):** no change, no copy.
- **Privacy notice and sub-processors:** no change. The same data goes to the same route.
- **Accessibility (keyboard, screen reader, reduced motion):** no change, no UI.
- **README screenshots:** no change, no rendered surface changes.
- **Changelog fragments and the release:** one `fixed` fragment, patch bump.
- **CI and GitHub Actions:** no workflow change. `lib/pwa/swReplay.ts` joins unit coverage, because only
  `app/sw.ts` is excluded. `WORKFLOW.md` makes `code-reviewer` a blocking gate for `app/sw.ts` and
  `lib/pwa/**`.

## Out of scope

- Other 4xx statuses (see Clarifications).
- What the worker does with the localStorage copy: a worker cannot reach localStorage.
- The copied client-side logic in the "BLOCKER 3" block of `lib/sync/swReplay.test.ts` (see
  Clarifications).
- `/api/sync` itself, including #2206.

## Removes

- The `simulateSwPush` block in `lib/sync/swReplay.test.ts`, a copy of the branches that the real tests
  replace (5 tests).
- `SW_REPLAY_MESSAGE` as a hand-kept duplicate in `app/sw.ts`: the handler imports the one in
  `lib/sync/backgroundSync.ts`, which has no imports and touches no browser global when loaded.

## Owner decisions this relies on

- 21 October 2026: every change goes through OpenSpec, bug fixes included.
- 23 October 2026: `root-cause` and `blast-radius` on every bug.
- 1 November 2026: spend waves build as draft PRs, nothing merged (ops #383).

## Clarifications

Nothing here has been put to Fraser yet. Each line is an open call with a recommendation.

- 2026-11-02 On a 400 or 409, keep the worker's queue or clear it? Recommended: keep. Those grades are not in the cloud, a 409 can clear with a deploy, the app's own 409 path keeps its queue, and the next write overwrites the copy. Clearing would be the same as the 401 branch, and the localStorage copy would survive, but it drops the only copy the worker can reach.
- 2026-11-02 Should other 4xx statuses (404, 408, 413, 429) stop too? Recommended: no. `/api/sync` sends none of them itself, and a 408 or 429 is worth retrying. The audit named 400 and 409 only.
- 2026-11-02 The success and 401 branches clear IndexedDB only, and the localStorage copy stays until the app next opens. Recommended: accept and record it in the spec; a worker cannot reach localStorage and the upsert is idempotent.
- 2026-11-02 Is the Node run of the real listener enough, or should a Chromium end-to-end test fire a real `sync` event? Recommended: enough for this change. A real Background Sync run has not been done, and an end-to-end test would need a production build in CI, so it would be its own issue if wanted.
- 2026-11-02 The "BLOCKER 3" tests in `lib/sync/swReplay.test.ts` also copy logic, from the client's ACK handler, and `components/sync/useOnlineReconnectSync.test.tsx` is the place for real ones. Recommended: a separate small change, so this one stays on the worker.
