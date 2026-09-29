import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Forcing function (#2053): offset pagination without a total order can skip
// rows when a concurrent write moves them. Every `.range(` call must have an
// `.order(` earlier in the same call chain.

/** Blank out comments (preserving offsets) so prose never counts as code. */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'`])\/\/.*$/gm, (m, p) =>
    p + blank(m.slice(p.length)),
  );
}

/**
 * Walk back from `idx` to the start of the enclosing expression: stop at an
 * unmatched opening bracket or at a `;` outside any bracket.
 */
function chainStart(code: string, idx: number): number {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const c = code[i];
    if (c === ")" || c === "}" || c === "]") depth++;
    else if (c === "(" || c === "{" || c === "[") {
      if (depth === 0) return i + 1;
      depth--;
    } else if (c === ";" && depth === 0) return i + 1;
  }
  return 0;
}

/** Line numbers of `.range(` calls with no `.order(` earlier in their chain. */
export function findUnorderedRanges(src: string): number[] {
  const code = stripComments(src);
  const bad: number[] = [];
  const re = /\.range\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const chain = code.slice(chainStart(code, m.index), m.index);
    if (!chain.includes(".order(")) {
      bad.push(code.slice(0, m.index).split("\n").length);
    }
  }
  return bad;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("findUnorderedRanges (fixtures)", () => {
  it("catches an unordered range in a file that also has an ordered query", () => {
    const src = `
      const a = await client.from("a").select("x").order("x").range(0, 9);
      const b = await client
        .from("b")
        .select("y")
        .range(0, 9);
    `;
    expect(findUnorderedRanges(src)).toEqual([6]);
  });

  it("accepts an ordered chain, including inside a fetchAllPages callback", () => {
    const src = `
      const d = await fetchAllPages((from, to) =>
        client.from("c").select("z").order("z", { ascending: true }).range(from, to),
      );
    `;
    expect(findUnorderedRanges(src)).toEqual([]);
  });

  it("ignores .range( and .order( that only appear in comments", () => {
    const src = `
      // client.from("a").order("x").range(0, 1)
      const q = client.from("a").select("x").range(0, 9); // .order(
    `;
    expect(findUnorderedRanges(src)).toEqual([3]);
    expect(findUnorderedRanges("/* .range(0, 1) */ const x = 1;")).toEqual([]);
  });
});

describe("paginated Supabase queries are ordered", () => {
  const root = join(__dirname, "..", "..");
  const files = [...walk(join(root, "lib")), ...walk(join(root, "app", "api"))];

  it("finds the known paginated sources", () => {
    const paged = files
      .filter((f) => stripComments(readFileSync(f, "utf8")).includes(".range("))
      .map((f) => relative(root, f));
    expect(paged).toEqual(
      expect.arrayContaining([
        "lib/sync/cloud.ts",
        "lib/sync/streak.ts",
        "lib/sync/gradeLog.ts",
        "app/api/export/route.ts",
        "app/api/push/send-daily/route.ts",
        "app/api/srs/optimize/route.ts",
      ]),
    );
  });

  it("orders every .range() call before paging", () => {
    const offenders = files.flatMap((f) =>
      findUnorderedRanges(readFileSync(f, "utf8")).map((line) => `${relative(root, f)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
