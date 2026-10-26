import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRESET_IDS } from "@/lib/eligibility/scopeConstants";

// Guard for the shared preset list (#2187). The seven preset sites (settings
// validator, legacy scope parser, client matcher, scope label, Scope control,
// server predicate, push route parser) live in these files. Each must take
// its preset ids from PRESET_IDS: no preset literal that is not on the list,
// and no hand-kept allow-list of its own.
const SITES = [
  "lib/settings/persistence.ts",
  "lib/review/scope.ts",
  "components/review/ScopeControl.tsx",
  "lib/eligibility/scopePredicate.ts",
  "app/api/push/send-daily/route.ts",
];

// Where a preset id appears as a literal in these files.
const PRESET_LITERAL_PATTERNS = [
  /presets\.includes\(\s*["']([^"']+)["']\s*\)/g,
  /(?<!typeof )(?<![.\w])(?:key|id)\s*[!=]==\s*["']([^"']+)["']/g,
];

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("PRESET_IDS is the one preset list", () => {
  it.each(SITES)("%s names no preset id that is off the list", (path) => {
    const text = source(path);
    const known = new Set<string>(PRESET_IDS);
    const unknown: string[] = [];
    for (const pattern of PRESET_LITERAL_PATTERNS) {
      for (const m of text.matchAll(pattern)) {
        if (!known.has(m[1])) unknown.push(m[1]);
      }
    }
    expect(unknown).toEqual([]);
  });

  it.each(SITES)("%s keeps no allow-list of its own", (path) => {
    const lists = source(path)
      .split("\n")
      .filter((line) => PRESET_IDS.filter((id) => line.includes(`"${id}"`)).length >= 2);
    expect(lists).toEqual([]);
  });

  it.each([
    "lib/settings/persistence.ts",
    "lib/review/scope.ts",
    "app/api/push/send-daily/route.ts",
  ])("%s validates stored presets with isPresetId", (path) => {
    // Called directly or passed to .filter, outside its own import line.
    expect(source(path).split("\n").some((l) => /\bisPresetId\b/.test(l) && !/^\s*(import|export|\s*isPresetId,)/.test(l))).toBe(true);
  });
});
