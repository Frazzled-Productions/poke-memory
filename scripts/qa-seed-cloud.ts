/**
 * QA cloud seeder - operator script (NOT run at app runtime).
 *
 * Usage (after building with esbuild via npm run qa:seed-cloud):
 *   npm run qa:seed-cloud <dataset|all> [--user <username>] [--dry-run]
 *
 * Required environment variables (unless --dry-run):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL - QA Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY               - Service-role key (never commit!)
 *
 * Optional:
 *   QA_SEED_PASSWORD - shared QA-user password (defaults to documented constant)
 *
 * Credentials: store in an untracked .env.qa.local file, never committed.
 * .env* is covered by .gitignore.
 *
 * --dry-run: builds and validates all datasets locally, makes NO network calls,
 *            requires NO environment variables. Safe to run in CI.
 *
 * Idempotent: if a QA user already exists, existing progress rows (card_reviews,
 * grade_log, streak_days) are deleted directly via the service-role client before
 * re-seeding. The auth user, usernames row, and user_settings are preserved.
 */

import { createClient } from "@supabase/supabase-js";
import {
  DATASET_BUILDERS,
  ALL_DATASET_NAMES,
  DEFAULT_QA_PASSWORD,
  PAIRING_EXEMPT_DATASETS,
  type DatasetName,
  type CloudCardRow,
} from "./qa-seed/cloud-datasets";
import { syntheticEmail } from "@/lib/auth/username";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const dryRun = args.includes("--dry-run");
const userArg = (() => {
  const idx = args.indexOf("--user");
  return idx !== -1 ? args[idx + 1] : undefined;
})();
const datasetArg = args.find((a) => !a.startsWith("--") && a !== (userArg ?? ""));

if (!datasetArg) {
  console.error("Usage: qa-seed-cloud <dataset|all> [--user <username>] [--dry-run]");
  console.error("Datasets:", ALL_DATASET_NAMES.join(", "), "or 'all'");
  process.exit(1);
}

const targetDatasets: DatasetName[] =
  datasetArg === "all"
    ? ALL_DATASET_NAMES
    : [datasetArg as DatasetName];

// Validate dataset name(s).
for (const name of targetDatasets) {
  if (!DATASET_BUILDERS[name]) {
    console.error(`Unknown dataset: "${name}". Valid names: ${ALL_DATASET_NAMES.join(", ")}, all`);
    process.exit(1);
  }
}

// Guard: --user with 'all' is almost always a mistake: each dataset iteration
// resets the same account, leaving only the last dataset's data on that account.
if (userArg !== undefined && datasetArg === "all") {
  console.error(
    "Error: --user cannot be combined with 'all'.\n" +
    "When seeding 'all', each dataset is seeded onto its own named account\n" +
    "(qa-fresh, qa-mastery, qa-locale, qa-streak, qa-conflict).\n" +
    "To seed a single dataset onto a custom account, name the dataset explicitly:\n" +
    `  qa:seed-cloud <dataset> --user ${userArg}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Dry-run mode: build + validate, no network calls
// ---------------------------------------------------------------------------

if (dryRun) {
  console.log("[dry-run] Building and validating datasets (no network calls) ...");
  let totalCards = 0;
  let totalStreak = 0;
  let totalGrades = 0;
  let ok = true;

  for (const name of targetDatasets) {
    const builder = DATASET_BUILDERS[name];
    let dataset;
    try {
      dataset = builder();
    } catch (err) {
      console.error(`  [FAIL] ${name}: builder threw:`, err);
      ok = false;
      continue;
    }

    // Basic shape checks.
    if (!Array.isArray(dataset.cardRows)) {
      console.error(`  [FAIL] ${name}: cardRows is not an array`);
      ok = false;
      continue;
    }

    // Validate sync-safety: only graduated cards (lastReview != null) are expected.
    const inStepRows = dataset.cardRows.filter(
      (r) => r.first_seen !== null && r.last_review === null,
    );
    if (inStepRows.length > 0) {
      console.error(`  [FAIL] ${name}: ${inStepRows.length} row(s) have first_seen set but last_review null (in-step, not sync-safe)`);
      ok = false;
    }

    // Validate unique (card_type, subject_key, locale) per dataset.
    const keys = dataset.cardRows.map((r) => `${r.card_type}:${r.subject_key}:${r.locale}`);
    const uniqueKeys = new Set(keys);
    if (uniqueKeys.size !== keys.length) {
      console.error(`  [FAIL] ${name}: duplicate (card_type, subject_key, locale) keys`);
      ok = false;
    }

    // Validate FSRS bounds on graduated cards.
    for (const row of dataset.cardRows) {
      if (row.last_review !== null) {
        // Graduated card must have valid FSRS numerics.
        if (!Number.isFinite(row.stability) || row.stability < 1e-3) {
          console.error(`  [FAIL] ${name}: row ${row.card_type}:${row.subject_key} stability out of bounds: ${row.stability}`);
          ok = false;
        }
        if (!Number.isFinite(row.difficulty) || row.difficulty < 1 || row.difficulty > 10) {
          console.error(`  [FAIL] ${name}: row ${row.card_type}:${row.subject_key} difficulty out of bounds: ${row.difficulty}`);
          ok = false;
        }
        if (row.reps < 1) {
          console.error(`  [FAIL] ${name}: graduated row ${row.card_type}:${row.subject_key} has reps < 1`);
          ok = false;
        }
        if (row.first_seen === null) {
          console.error(`  [FAIL] ${name}: graduated row ${row.card_type}:${row.subject_key} has null first_seen`);
          ok = false;
        }
      }
    }

    // Validate name+reverse pairing for mastered cards.
    const masteredNames = new Set(
      dataset.cardRows
        .filter(
          (r) =>
            r.card_type === "name" &&
            r.reps >= 3 &&
            r.scheduled_days >= 21,
        )
        .map((r) => `${r.subject_key}:${r.locale}`),
    );
    const masteredReverse = new Set(
      dataset.cardRows
        .filter(
          (r) =>
            r.card_type === "reverse" &&
            r.reps >= 3 &&
            r.scheduled_days >= 21,
        )
        .map((r) => `${r.subject_key}:${r.locale}`),
    );
    // For datasets not in PAIRING_EXEMPT_DATASETS, both mastered name and reverse must be present.
    if (!PAIRING_EXEMPT_DATASETS.includes(name)) {
      for (const key of masteredNames) {
        if (!masteredReverse.has(key)) {
          console.error(`  [FAIL] ${name}: mastered name ${key} has no matching mastered reverse (#1234 pairing)`);
          ok = false;
        }
      }
    }

    console.log(
      `  [OK]   ${name}: ${dataset.cardRows.length} card rows, ${dataset.streakRows.length} streak rows, ` +
      `${dataset.gradeLogRows.length} grade-log rows`,
    );
    totalCards += dataset.cardRows.length;
    totalStreak += dataset.streakRows.length;
    totalGrades += dataset.gradeLogRows.length;
  }

  console.log(
    `\n[dry-run] Summary: ${targetDatasets.length} dataset(s), ` +
    `${totalCards} card rows, ${totalStreak} streak rows, ${totalGrades} grade-log rows.`,
  );

  if (!ok) {
    console.error("[dry-run] FAILED - see errors above.");
    process.exit(1);
  }
  console.log("[dry-run] All datasets valid. No network calls made.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Live mode: validate env vars, create Supabase client, seed each dataset
// ---------------------------------------------------------------------------

const supabaseUrl =
  process.env["SUPABASE_URL"] ?? process.env["NEXT_PUBLIC_SUPABASE_URL"];
const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!supabaseUrl) {
  console.error(
    "Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL. " +
    "Set these in .env.qa.local or the calling shell. " +
    "Use --dry-run to run without credentials.",
  );
  process.exit(1);
}
if (!serviceRoleKey) {
  console.error(
    "Missing SUPABASE_SERVICE_ROLE_KEY. " +
    "Set this in .env.qa.local or the calling shell. " +
    "Use --dry-run to run without credentials.",
  );
  process.exit(1);
}

const qaPassword =
  process.env["QA_SEED_PASSWORD"] ?? DEFAULT_QA_PASSWORD;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// User management helpers
// ---------------------------------------------------------------------------

/**
 * Ensures the auth user exists. If it doesn't, creates it with
 * email_confirm: true and user_metadata.username set.
 * Returns the user_id on success, throws on failure.
 */
async function ensureAuthUser(username: string): Promise<string> {
  const email = syntheticEmail(username);

  // Paginate listUsers to handle QA projects with > 50 auth rows (the default page size).
  const allUsers: { id: string; email?: string }[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    allUsers.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }

  const existing = allUsers.find((u) => u.email === email);
  if (existing) {
    console.log(`  User '${username}' already exists (id=${existing.id})`);
    return existing.id;
  }

  // Create new auth user.
  const { data: createData, error: createError } = await admin.auth.admin.createUser({
    email,
    password: qaPassword,
    email_confirm: true,
    user_metadata: { username },
  });
  if (createError || !createData.user) {
    throw new Error(`createUser failed for '${username}': ${createError?.message ?? "no user returned"}`);
  }
  console.log(`  Created auth user '${username}' (id=${createData.user.id})`);
  return createData.user.id;
}

/**
 * Ensures the usernames table has a row for this user. Idempotent.
 */
async function ensureUsernamesRow(username: string, userId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("usernames")
    .upsert({ username, user_id: userId }, { onConflict: "username", ignoreDuplicates: true });
  if (error) {
    // Non-fatal: row may already exist from a prior run. Log and continue.
    console.warn(`  usernames upsert for '${username}': ${error.message}`);
  }
}

/**
 * Calls the reset_all_progress RPC for the given user, bypassing RLS via the
 * service-role client. Note: reset_all_progress reads auth.uid() server-side
 * when called through the normal client. With the service-role client we must
 * pass the user_id explicitly via a custom RPC call, or delete rows directly.
 *
 * Because the service-role key bypasses RLS, we delete directly rather than
 * relying on the SECURITY DEFINER RPC (which reads auth.uid() from JWT claims).
 */
async function resetUserProgress(userId: string): Promise<void> {
  const deleteFrom = async (table: string) => {
    // Service-role client bypasses RLS; type cast avoids the generated-types gap.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from(table).delete().eq("user_id", userId);
    if (error) {
      throw new Error(`Delete from ${table} for user ${userId} failed: ${error.message}`);
    }
  };

  await deleteFrom("card_reviews");
  await deleteFrom("grade_log");
  await deleteFrom("streak_days");
  // user_settings is intentionally kept (matches reset_all_progress semantics).
}

// ---------------------------------------------------------------------------
// Upsert helpers
// ---------------------------------------------------------------------------

const BATCH_SIZE = 200;

async function upsertCardRows(userId: string, rows: CloudCardRow[]): Promise<void> {
  const updatedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
      ...r,
      user_id: userId,
      updated_at: updatedAt,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("card_reviews")
      .upsert(batch, {
        onConflict: "user_id,card_type,subject_key,locale",
      });
    if (error) {
      throw new Error(`card_reviews upsert failed (batch ${Math.floor(i / BATCH_SIZE)}): ${error.message}`);
    }
  }
}

async function upsertStreakRows(
  userId: string,
  rows: { review_date: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
      user_id: userId,
      review_date: r.review_date,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("streak_days")
      .upsert(batch, { onConflict: "user_id,review_date", ignoreDuplicates: true });
    if (error) {
      throw new Error(`streak_days upsert failed: ${error.message}`);
    }
  }
}

async function insertGradeLogRows(
  userId: string,
  rows: {
    occurred_at: number;
    entry_date: string;
    card_type: string;
    grade: number;
    subject_key: string | null;
    locale: string;
    learning_step: number | null;
    step_started_at: number | null;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
      user_id: userId,
      ...r,
    }));
    // resetUserProgress always deletes grade_log rows first, so a plain insert is correct here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("grade_log")
      .insert(batch);
    if (error) {
      throw new Error(`grade_log insert failed: ${error.message}`);
    }
  }
}

async function pushUserSettings(
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  // Use merge_user_settings RPC (migration 011/014) for the JSONB settings blob.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).rpc("merge_user_settings", {
    p_user_id: userId,
    p_patch: patch,
  });
  if (error) {
    // Best-effort: settings are not critical for the card data to be correct.
    console.warn(`  merge_user_settings for user ${userId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main seeding loop
// ---------------------------------------------------------------------------

async function seedDataset(username: string, datasetName: DatasetName): Promise<void> {
  console.log(`\nSeeding '${datasetName}' for user '${username}' ...`);

  const userId = await ensureAuthUser(username);
  await ensureUsernamesRow(username, userId);

  console.log(`  Resetting existing progress for user ${userId} ...`);
  await resetUserProgress(userId);

  const dataset = DATASET_BUILDERS[datasetName]();
  console.log(
    `  Dataset: ${dataset.cardRows.length} card rows, ` +
    `${dataset.streakRows.length} streak rows, ` +
    `${dataset.gradeLogRows.length} grade-log rows.`,
  );
  console.log(`  Description: ${dataset.description}`);

  if (dataset.cardRows.length > 0) {
    await upsertCardRows(userId, dataset.cardRows);
    console.log(`  card_reviews: ${dataset.cardRows.length} rows upserted.`);
  }

  if (dataset.streakRows.length > 0) {
    await upsertStreakRows(userId, dataset.streakRows);
    console.log(`  streak_days: ${dataset.streakRows.length} rows upserted.`);
  }

  if (dataset.gradeLogRows.length > 0) {
    await insertGradeLogRows(userId, dataset.gradeLogRows);
    console.log(`  grade_log: ${dataset.gradeLogRows.length} rows upserted.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushUserSettings(userId, dataset.settingsPatch as any);
  if (Object.keys(dataset.settingsPatch).length > 0) {
    console.log(`  user_settings: patch applied.`);
  }

  console.log(`  Done: '${datasetName}' seeded for user '${username}' (id=${userId}).`);
}

async function main() {
  console.log("[qa-seed-cloud] Starting ...");
  console.log(`  Supabase URL: ${supabaseUrl}`);
  console.log(`  Datasets: ${targetDatasets.join(", ")}`);
  if (userArg) {
    console.log(`  --user override: ${userArg}`);
  }

  for (const datasetName of targetDatasets) {
    const username = userArg ?? datasetName;
    try {
      await seedDataset(username, datasetName);
    } catch (err) {
      console.error(`[FAIL] ${datasetName} (user=${username}):`, err);
      process.exit(1);
    }
  }

  console.log("\n[qa-seed-cloud] All datasets seeded successfully.");
}

main().catch((err) => {
  console.error("[qa-seed-cloud] Fatal error:", err);
  process.exit(1);
});
