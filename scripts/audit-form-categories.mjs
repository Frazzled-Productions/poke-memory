// scripts/audit-form-categories.mjs
//
// Cross-checks every non-default form in lib/pokemon/generated.json against
// PokéAPI and reports entries whose formCategory does not match the expected
// value derived from the form's form_name.
//
// Run with: npm run audit:forms  (or: node scripts/audit-form-categories.mjs)
//
// Options:
//   --apply   Overwrite generated.json with the corrected values (dry-run by
//             default — only prints the diff).
//   --json    Print results as JSON instead of human-readable text.
//
// Rate-limit note: PokéAPI advises ~100 req/min. This script caps concurrency
// at 20 requests at a time, matching the main seed script's CONCURRENCY value.
// Do not increase this without adjusting CONCURRENCY.

import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_PATH = resolve(__dirname, "../lib/pokemon/generated.json");

const CONCURRENCY = 20;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];
const POKEAPI_BASE = "https://pokeapi.co/api/v2";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const applyFix = args.includes("--apply");
const jsonOutput = args.includes("--json");

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        return { ok: false, reason: `HTTP ${res.status}` };
      }
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      return { ok: true, data: await res.json() };
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return { ok: false, reason: String(err) };
    }
  }
}

async function runConcurrently(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Form category derivation — must stay in sync with seed-pokemon.mjs
//
// This function is intentionally identical to `formCategoryFor` in
// seed-pokemon.mjs.  The `formData.is_default` field is NOT used (see that
// function's comment for the full rationale — PokéAPI can set it on non-
// default varieties, which was the root cause of the original misclassification
// bug reported in issue #837).
// ---------------------------------------------------------------------------

function deriveFormCategory(formName) {
  const fn = formName ?? "";
  if (/^(alola|galar|hisui|paldea)/.test(fn)) return "regional";
  if (/^mega/.test(fn)) return "mega";
  if (fn === "gmax") return "gmax";
  if (fn === "primal") return "primal";
  if (fn === "") return "default";
  return "forme";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(GENERATED_PATH)) {
    process.stderr.write(`[audit] ERROR: ${GENERATED_PATH} not found\n`);
    process.exit(1);
  }

  const raw = await readFile(GENERATED_PATH, "utf-8");
  const seed = JSON.parse(raw);

  // Only non-default forms have a formCategory that needs auditing — the
  // default-form record is always emitted with formCategory: "default" by the
  // seed script and is never fed through formCategoryFor.
  const candidates = seed.filter((p) => p.isDefaultForm === false && p.formSlug);

  if (!jsonOutput) {
    process.stdout.write(
      `[audit] Checking ${candidates.length} non-default form entries against PokéAPI...\n`
    );
  }

  // Build tasks: fetch the pokemon-form endpoint for each candidate and derive
  // the expected formCategory from the returned form_name.
  const tasks = candidates.map((p) => async () => {
    const formUrl = `${POKEAPI_BASE}/pokemon-form/${p.id}/`;
    const result = await fetchWithRetry(formUrl);
    if (!result.ok) {
      return {
        id: p.id,
        name: p.name,
        formSlug: p.formSlug,
        seedCategory: p.formCategory,
        apiFormName: null,
        expectedCategory: null,
        mismatch: false,
        fetchError: result.reason,
      };
    }

    const formName = result.data.form_name ?? "";
    const expected = deriveFormCategory(formName);
    const mismatch = p.formCategory !== expected;

    return {
      id: p.id,
      name: p.name,
      formSlug: p.formSlug,
      seedCategory: p.formCategory,
      apiFormName: formName,
      expectedCategory: expected,
      mismatch,
      fetchError: null,
    };
  });

  const results = await runConcurrently(tasks, CONCURRENCY);

  const mismatches = results.filter((r) => r.mismatch);
  const errors = results.filter((r) => r.fetchError);

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  if (jsonOutput) {
    process.stdout.write(
      JSON.stringify({ checked: candidates.length, mismatches, errors }, null, 2) + "\n"
    );
  } else {
    if (errors.length > 0) {
      process.stdout.write(`\n[audit] FETCH ERRORS (${errors.length}):\n`);
      for (const e of errors) {
        process.stdout.write(
          `  id=${e.id} ${e.name}: ${e.fetchError}\n`
        );
      }
    }

    if (mismatches.length === 0) {
      process.stdout.write(
        `[audit] All ${candidates.length} form entries have the correct formCategory.\n`
      );
    } else {
      process.stdout.write(`\n[audit] MISMATCHES (${mismatches.length}):\n`);
      for (const m of mismatches) {
        process.stdout.write(
          `  id=${m.id} ${m.name}  form_name="${m.apiFormName}"` +
            `  seed="${m.seedCategory}"  expected="${m.expectedCategory}"\n`
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Apply corrections
  // ---------------------------------------------------------------------------

  if (applyFix && mismatches.length > 0) {
    const corrections = new Map(mismatches.map((m) => [m.id, m.expectedCategory]));
    let applied = 0;
    for (const p of seed) {
      if (corrections.has(p.id)) {
        p.formCategory = corrections.get(p.id);
        applied++;
      }
    }
    const tmp = `${GENERATED_PATH}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(seed, null, 2) + "\n");
    await rename(tmp, GENERATED_PATH);
    if (!jsonOutput) {
      process.stdout.write(
        `[audit] Applied ${applied} correction(s) to ${GENERATED_PATH}\n`
      );
    }
  } else if (applyFix && mismatches.length === 0) {
    if (!jsonOutput) {
      process.stdout.write("[audit] Nothing to apply — no mismatches found.\n");
    }
  }

  // Exit with non-zero status when there are unresolved mismatches (dry-run
  // mode) so CI can detect drift after a future seed regeneration.
  if (!applyFix && mismatches.length > 0) {
    process.exit(1);
  }

  // Exit non-zero whenever any PokéAPI fetch failed — regardless of --apply or
  // mismatch count. A partial audit must not report success: unfetched forms
  // could be hiding real drift, so a clean exit code would mask the gap.
  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[audit] Fatal: ${err}\n`);
  process.exit(1);
});
