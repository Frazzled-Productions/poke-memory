// Daily app-open counts (design D9, migration 0003_events.sql). The SQL lives here
// so the scoped-query rule (scripts/check-scoped-queries.mjs) keeps every D1 call
// inside lib/db/. The table holds no per-user data.

type CountEventDb = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
};

const UPSERT =
  "INSERT INTO events (day, name, user_type, progress_bucket, count) VALUES (?1, ?2, ?3, ?4, 1) " +
  "ON CONFLICT (day, name, user_type, progress_bucket) DO UPDATE SET count = count + 1";

/** Adds one to the day's count for this event and bucket pair. */
export async function countEvent(
  db: CountEventDb,
  day: string,
  name: string,
  userType: string,
  progressBucket: string,
): Promise<void> {
  await db.prepare(UPSERT).bind(day, name, userType, progressBucket).run();
}
