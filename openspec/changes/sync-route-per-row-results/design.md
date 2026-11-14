## Root cause

**First wrong step:** `app/api/sync/route.ts:204` (on `qa` at `d2456f44`). `if (batchHadGoodRow) batchOk
= true` turns four per-row outcomes (landed, rejected, structural, unknown) into one flag, "did anything
land", and the response is built from that.

**Current behaviour**

| Queue | Row results | Route today | Should be |
|---|---|---|---|
| Good, stale, third row hits a timeout | landed, `23514`, `57014` | 200, client clears queue | 502 |
| Good, stale, third row's request throws | landed, `23514`, thrown | 200 | 502 |
| One stale card | `23514` | 502, false banner, retries | 200 |
| Stale, then a row with a structural error | `23514`, `23503` | 502, or 200 if another row landed | 409 with the code |

**Expected behaviour:** the last column.

**Unchanged behaviour**

- WHEN a batch upserts cleanly THEN the route SHALL CONTINUE TO return 200.
- WHEN a stale card sits beside good cards THEN the good cards SHALL CONTINUE TO land.
- WHEN a batch fails with a transient error THEN the route SHALL CONTINUE TO retry it three times, then return 502.
- WHEN a batch fails with a structural error THEN the route SHALL CONTINUE TO return 409 at once.
- WHEN one batch of more than 200 cards fails for a transient reason THEN later batches SHALL CONTINUE TO run.
- WHEN the grade-log leg fails THEN the response SHALL CONTINUE TO be unaffected.

**Tried before:** #1856 (F23) added this fallback in `2ea0fbf6` so one bad row could not sink 199 good
ones. That fix is right. Its "at least one row landed" rule is what this change corrects, and it had no
tests: `23514` appeared in no test under `app/api/sync/`.

**Hypotheses ruled out**

- *`23514` never reaches the route as a code.* Ruled out: the real trigger through a real
  `INSERT ... ON CONFLICT` gave `error.code` `23514`, Postgres 15 (the integration test goes red with
  502 on the stale-only queue, not a thrown error).
- *The client treats a stale-only 502 as harmless.* Ruled out by reading: `lib/sync/useSyncOnUnload.ts`
  sets `lastPushFailed: !ok` and registers Background Sync; `components/sync/useSyncOnUnload.test.tsx:178`
  pins it.

**Evidence**

- **Seen**, unit tests against the real route with a mocked client, before the fix: exit 1, 6 failed, 17
  passed. `expected 200 to be 502` (transient, thrown, next batch), `expected 502 to be 200` (stale only),
  `expected 200 to be 409` (structural), `expected "vi.fn()" to be called 3 times, but got 203 times`
  (structural row did not stop).
- **Seen**, the real route, trigger and CHECKs on `postgres:15-alpine`, before the fix: exit 1, 3 failed,
  1 passed. Same two status mismatches.
- **Cited:** `lib/sync/useSyncOnUnload.ts:178` and `app/sw.ts:716` clear the queue on a 2xx.
- **Unknown:** how often this happens in production. The audit found it by reading the code. The Vercel
  connection reaches one team, which has no Poké Memory project, so `[sync/route] per-row upsert error`
  could not be counted.
- **Inferred:** the structural branch is rarely reachable. Plan-time `42xxx` errors fail the batch before
  any row runs, and `card_reviews` has one foreign key (`user_id`), shared by every row. The 409 branch
  costs six lines and keeps the route honest.

**Same fault elsewhere:** `usePerGradeSync` and `pushSingleCard` already keep separate `rejected` and
`failed` outcomes (`lib/sync/cloud.ts:274`), and `gradeLog` has `pushGradeLogDetailed`. Only this route
collapsed them.

**Always-on signal:** the thrown per-row error now logs `[sync/route] per-row upsert threw`. Before, the
transient case left nothing.

## Decisions

**One flag, not two.** The audit named `rowUnknownFailure` and `rowRejected`. A rejected row changes
nothing, so only the first is needed.

**No retry per row.** See open call 3. The batch `break` stays: the fallback runs once per batch.

**Stop at a structural row.** `break outerLoop`, as for a batch. See open call 2.

## Blast radius

**The fact it is safe because of:** replaying a queue after a 502 cannot regress a column the trigger
guards. Rows that already landed upsert again, and the stale row is rejected again. Rung 4: integration test "a transient
row failure returns 502, and replaying the same queue lands the row" on real Postgres, exit 0: first
POST 502 with the row absent, same queue again 200 with the row present.

Risks:

- `hidden_since` and `due_date` are not guarded, so a replay writes back the queue's values. Seen on
  `postgres:15`: a row whose cloud copy had `hidden_since` set and `due_date` moved, then replayed, returned
  200 with `hidden_since` null and the old `due_date`. It needs another device to change the row between
  the 502 and a late replay, and any stale push does the same today. Noted in #2331.
- A malformed row is now evicted on this path, not kept and retried forever. `app/api/sync/route.ts`.
  Rare: the client produces these rows. Cost: the row never reaches the cloud, which was already true.
  Pinned by "a row outside a table CHECK is also 23514". Open call 1.
- A legitimate same-day re-grade the trigger rejects (the known limitation in `docs/sync.md`) now
  leaves the queue on a 200 instead of a 502. Same end state: the drain path evicts it on `rejected`
  (`lib/sync/usePerGradeSync.ts:273`). Accepted.
- A true row failure now shows a real "Sync failed" banner it did not before. Intended.
- The `pagehide` path still clears the queue whatever the server answers. Not new, out of scope.
- A 409 from a row sets `structuralSyncError`, which stops later drains until a push succeeds. Same as
  a batch 409; rarely reachable (above).

Cleared:

- Nothing outside the route reads `[sync/route]` log text (`git grep`: no hits).
- `partial_failure` and `structural_error` response shapes are unchanged, and
  `components/sync/useSyncOnUnload.test.tsx` passes.
- Grade-log leg: separate function, not touched.
- Full suite after the fix: tasks 2.4.
