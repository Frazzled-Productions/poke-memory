/**
 * Lint fixtures for the lib/db/system import restriction (design D4, task
 * 2.4): ESLint's no-restricted-imports in eslint.config.mjs lets only the
 * cron, push-send, Discord and feedback routes and lib/db import it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const eslint = new ESLint({ cwd: ROOT });

async function restrictedImportErrors(file: string, specifier: string): Promise<string[]> {
  const code = `import { getPushTargets } from "${specifier}";\nexport const f = getPushTargets;\n`;
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message);
}

describe("lib/db/system import restriction", () => {
  it.each([
    ["components/settings/Fixture.tsx", "@/lib/db/system"],
    ["app/settings/fixture.tsx", "@/lib/db/system/push"],
    ["app/api/sync/fixture.ts", "@/lib/db/system"],
    ["app/api/push/resubscribe/fixture.ts", "@/lib/db/system"],
    ["lib/sync/fixture.ts", "../db/system"],
    ["lib/discord/fixture.ts", "../db/system/feedback"],
    ["app/api/export/fixture.ts", "../../../lib/db/system"],
  ])("refuses %s importing %s", async (file, specifier) => {
    const errors = await restrictedImportErrors(file, specifier);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/lib\/db\/system reads across users/);
  }, 60_000);

  it.each([
    ["app/api/cron/backup/fixture.ts", "@/lib/db/system"],
    ["app/api/push/send-daily/fixture.ts", "@/lib/db/system"],
    ["app/api/push/send-streak-nudge/fixture.test.tsx", "@/lib/db/system"],
    ["app/api/discord/notify/fixture.ts", "@/lib/db/system"],
    ["app/api/feedback/fixture.ts", "@/lib/db/system"],
    ["lib/db/rpc/fixture.ts", "../system"],
    ["lib/db/backup.ts", "./system/backup"],
  ])("allows %s importing %s", async (file, specifier) => {
    expect(await restrictedImportErrors(file, specifier)).toEqual([]);
  }, 60_000);

  it("leaves other lib/db modules importable everywhere", async () => {
    expect(await restrictedImportErrors("components/Fixture.tsx", "@/lib/db/scope")).toEqual([]);
    expect(await restrictedImportErrors("components/Fixture.tsx", "@/lib/db/systemic")).toEqual([]);
  }, 60_000);
});
