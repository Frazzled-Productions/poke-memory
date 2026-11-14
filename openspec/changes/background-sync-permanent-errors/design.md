## Root cause

Traced on 2 November 2026 (`root-cause` skill) on `origin/qa` at `d2456f44`. Surface: the real
`app/sw.ts`, bundled with esbuild and driven through its `sync` listener in Node with `fake-indexeddb`.
A real Chromium Background Sync event was not used, so the browser's own retry schedule was not seen.

- **Current behaviour (Seen):** with a queue in IndexedDB and no clients, a 409 from `/api/sync` makes
  the sync promise reject with `[sw-sync] /api/sync returned 409`, and a 400 does the same. A rejected
  sync event is one the browser retries, and the request body has not changed.
- **Expected behaviour:** a 400 or 409 resolves the event, so the browser stops, and keeps the queue.
- **Unchanged behaviour:**
  - WHEN a client ACKs THEN the worker SHALL CONTINUE TO leave the push to it.
  - WHEN no client ACKs within 3 seconds THEN the worker SHALL CONTINUE TO push the queue itself.
  - WHEN the queue is empty THEN the worker SHALL CONTINUE TO resolve without a request.
  - WHEN the response is 2xx, 401 or 403 THEN the worker SHALL CONTINUE TO resolve and clear IndexedDB.
  - WHEN the response is a 5xx or the request fails THEN the worker SHALL CONTINUE TO reject.
- **Tried before:** #1072 made 401 and 403 resolve, and added the specification test that copies the
  branches. #1358 added the route's 409 in the release merged as #1420, for the app's fetch path, and
  did not change the worker.
- **Hypotheses ruled out:**
  - The worker never sees a 400 or 409: it can. The route returns them to any caller
    (`app/api/sync/route.ts:45`, `:224`), and the parse guard returns 400 for bad JSON.
  - An existing test covers the branch: mutating the real 401 branch left `lib/sync/swReplay.test.ts`
    green (18 passed, exit 0), while the new file failed (4 failed, 11 passed, exit 1).
- **First wrong step (Cited):** `app/sw.ts:709` on `qa`, `if (!res.ok)` then throw, treats every other
  non-2xx as transient. That was true when written; the 409 came later and nothing could fail for the
  worker, because the logic sat inside the listener.
- **Same fault elsewhere:** the "BLOCKER 3" block in `lib/sync/swReplay.test.ts` copies the client's ACK
  logic (see Clarifications). No other worker handler branches on `/api/sync`.
- **Failing test before the fix:** `lib/pwa/swReplayHandler.test.ts`, the 400 and 409 cases, run
  against the moved but unchanged handler.
- **Always-on signal:** the real handler is now under unit coverage, so a new branch shows in the
  diff-coverage gate.

## Approach

Move first, then change. `replayPendingGrades` is the old body with `self.clients`, `fetch` and the two
IndexedDB helpers replaced by injected dependencies; a whitespace-blind diff of the two shows only those
substitutions and the new branch. The listener passes `fetch` through an arrow, because calling the
global as `deps.fetch()` is an illegal invocation in a browser, which the handler would read as a
network error and retry for ever.

The new branch sits after the auth branch and before the generic failure, and returns without clearing.

## Safety

The one fact this rests on: for every outcome other than 400 and 409, the worker does exactly what it
did before. Proved by running the same nine scenarios through the real listener of `qa` and of this
change: posts, outcome and queue state match on seven, and the two that differ are 400 and 409 going
from rejected to resolved, with the queue kept on both sides.
