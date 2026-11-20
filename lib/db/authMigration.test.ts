import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("db/d1/migrations/0002_auth.sql", () => {
  it("matches the schema the installed better-auth generates (username plugin)", () => {
    const out = execFileSync(
      process.execPath,
      ["scripts/cloudflare/generate-auth-migration.mjs", "--check"],
      { encoding: "utf8" },
    );
    expect(out).toContain("matches");
  }, 30_000);
});
