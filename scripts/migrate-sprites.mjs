// scripts/migrate-sprites.mjs
// One-off: reads lib/pokemon/generated.json, downloads sprites to
// public/sprites/pokemon/, rewrites spriteUrl to local paths.
// Run with: node scripts/migrate-sprites.mjs

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONCURRENCY = 20;

async function downloadSprite(url, destPath) {
  if (existsSync(destPath)) return { ok: true, skipped: true };

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, skipped: false, reason: err.message };
  }

  if (!res.ok) {
    return { ok: false, skipped: false, reason: `HTTP ${res.status}` };
  }

  try {
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(destPath, buffer);
    return { ok: true, skipped: false };
  } catch (err) {
    return { ok: false, skipped: false, reason: err.message };
  }
}

async function main() {
  const generatedPath = resolve(__dirname, "../lib/pokemon/generated.json");
  const spritesDir = resolve(__dirname, "../public/sprites/pokemon");

  const records = JSON.parse(
    await (await import("node:fs/promises")).readFile(generatedPath, "utf-8")
  );

  process.stderr.write(`[migrate-sprites] ${records.length} records found\n`);

  await mkdir(spritesDir, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += CONCURRENCY) {
    const batch = records.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (record) => {
      const destPath = resolve(spritesDir, `${record.id}.png`);
      const result = await downloadSprite(record.spriteUrl, destPath);
      if (!result.ok) {
        process.stderr.write(
          `[migrate-sprites] WARN: failed for ${record.id} (${record.name}): ${result.reason}\n`
        );
        failed++;
      } else if (result.skipped) {
        skipped++;
      } else {
        downloaded++;
      }
    }));
    if ((i / CONCURRENCY) % 5 === 4) {
      process.stderr.write(
        `[migrate-sprites] ${Math.min(i + CONCURRENCY, records.length)}/${records.length} processed\n`
      );
    }
  }

  process.stderr.write(
    `[migrate-sprites] Done: ${downloaded} downloaded, ${skipped} already existed, ${failed} failed\n`
  );

  // Rewrite spriteUrl to local paths
  const updated = records.map((r) => ({
    ...r,
    spriteUrl: `/sprites/pokemon/${r.id}.png`,
  }));

  await writeFile(generatedPath, JSON.stringify(updated, null, 2), "utf-8");
  process.stderr.write(
    `[migrate-sprites] Rewrote ${updated.length} spriteUrl entries to local paths\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[migrate-sprites] FATAL: ${err.message}\n`);
  process.exit(1);
});
