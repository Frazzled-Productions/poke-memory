import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Forcing function (#2053): offset pagination without a total order can skip
// rows when a concurrent write moves them. Any lib/sync source that pages with
// `.range(` must also `.order(`.
describe("lib/sync paginated pulls are ordered", () => {
  const dir = __dirname;
  const sources = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "paginatedFetch.ts",
  );

  it.each(sources)("%s orders any .range() query", (file) => {
    const src = readFileSync(join(dir, file), "utf8");
    if (!src.includes(".range(")) return;
    expect(src).toContain(".order(");
  });

  it("finds the known paginated sources", () => {
    const paged = sources.filter((f) => readFileSync(join(dir, f), "utf8").includes(".range("));
    expect(paged).toEqual(expect.arrayContaining(["cloud.ts", "streak.ts", "gradeLog.ts"]));
  });
});
