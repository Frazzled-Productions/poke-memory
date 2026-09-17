/**
 * Forcing-function test for the TypeScript ignore rule in .github/dependabot.yml
 * (#2075).
 *
 * TypeScript 7 is blocked (#1921), so the npm entry ignores `typescript`
 * semver-major updates; without the rule every `tooling` group PR carried 7.x
 * and could not pass CI. The rule is relative to the installed version, so a
 * copy left behind after the #1921 upgrade would silently block 8.x. This test
 * pins both directions: the rule must exist while package.json is below the
 * blocked major, and must be gone once it reaches it.
 *
 * It lives under scripts/ rather than lib/tooling/ because it guards CI config,
 * not product code, and lib/** changes trip the changelog gate.
 *
 * No YAML parser is a declared dependency, so the reader below handles only the
 * shape dependabot.yml uses: `- package-ecosystem:` update entries at two-space
 * indent, each with an optional `ignore:` list of flow-sequence `update-types`.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The TypeScript major #1921 blocks. Update this, or delete the test with the
// rule, when #1921 is resolved.
const BLOCKED_TYPESCRIPT_MAJOR = 7;
const SEMVER_MAJOR = "version-update:semver-major";

/**
 * @param {string} text dependabot.yml contents
 * @returns {Record<string, { dependencyName: string, updateTypes: string[] }[]>}
 *   ignore rules keyed by package-ecosystem
 */
function readIgnoreRules(text) {
  /** @type {Record<string, { dependencyName: string, updateTypes: string[] }[]>} */
  const rules = {};
  let ecosystem = null;
  let ignoreIndent = -1;
  let current = null;

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;

    const entry = raw.match(/^ {2}- package-ecosystem:\s*"?([\w-]+)"?/);
    if (entry) {
      ecosystem = entry[1];
      rules[ecosystem] = [];
      ignoreIndent = -1;
      current = null;
      continue;
    }
    if (ecosystem === null) continue;

    if (/^ignore:\s*$/.test(trimmed)) {
      ignoreIndent = indent;
      continue;
    }
    if (ignoreIndent < 0) continue;
    if (indent <= ignoreIndent) {
      ignoreIndent = -1;
      current = null;
      continue;
    }

    const body = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed;
    if (trimmed.startsWith("- ")) {
      current = { dependencyName: "", updateTypes: [] };
      rules[ecosystem].push(current);
    }
    if (current === null) continue;

    const name = body.match(/^dependency-name:\s*"?([^"\s]+)"?/);
    if (name) current.dependencyName = name[1];
    const types = body.match(/^update-types:\s*\[(.*)\]/);
    if (types) {
      current.updateTypes = types[1]
        .split(",")
        .map((t) => t.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
    }
  }
  return rules;
}

/**
 * @param {string} typescriptRange package.json devDependencies.typescript
 * @param {{ dependencyName: string, updateTypes: string[] }[]} npmRules
 * @returns {string[]} problems; empty when the rule matches the blocker state
 */
function checkTypescriptIgnore(typescriptRange, npmRules) {
  const major = Number(typescriptRange.match(/\d+/)?.[0]);
  if (!Number.isInteger(major)) {
    return [`cannot read a major from typescript range "${typescriptRange}"`];
  }
  const tsRules = npmRules.filter((r) => r.dependencyName === "typescript");

  if (major >= BLOCKED_TYPESCRIPT_MAJOR) {
    return tsRules.length === 0
      ? []
      : [
          `package.json is on typescript ${major}, so #1921 has landed: remove the ` +
            `typescript ignore rule from .github/dependabot.yml, or it will block ` +
            `the next major silently`,
        ];
  }
  if (tsRules.length !== 1) {
    return [
      `expected exactly one typescript ignore rule on the npm entry while ` +
        `typescript ${BLOCKED_TYPESCRIPT_MAJOR} is blocked (#1921), found ${tsRules.length}`,
    ];
  }
  const [rule] = tsRules;
  // Anything broader than semver-major (or no update-types at all, which
  // ignores every version) would also stop 6.x minor and patch updates.
  if (rule.updateTypes.length !== 1 || rule.updateTypes[0] !== SEMVER_MAJOR) {
    return [
      `the typescript ignore rule must set update-types to ["${SEMVER_MAJOR}"] ` +
        `only, found [${rule.updateTypes.join(", ")}]`,
    ];
  }
  return [];
}

describe("dependabot.yml: TypeScript major ignore rule (#2075)", () => {
  it("matches the blocker state of the typescript version in package.json", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const config = readFileSync(resolve(repoRoot, ".github/dependabot.yml"), "utf8");
    const rules = readIgnoreRules(config);

    expect(rules.npm, "no npm update entry found in dependabot.yml").toBeDefined();
    expect(checkTypescriptIgnore(pkg.devDependencies.typescript, rules.npm)).toEqual([]);
  });

  it("keeps the rule off the github-actions entry", () => {
    const config = readFileSync(resolve(repoRoot, ".github/dependabot.yml"), "utf8");
    const rules = readIgnoreRules(config);

    expect(rules["github-actions"]).toBeDefined();
    expect(rules["github-actions"].some((r) => r.dependencyName === "typescript")).toBe(false);
  });
});

describe("checkTypescriptIgnore", () => {
  const majorRule = { dependencyName: "typescript", updateTypes: [SEMVER_MAJOR] };

  it("passes a semver-major rule while below the blocked major", () => {
    expect(checkTypescriptIgnore("^6", [majorRule])).toEqual([]);
  });

  it("fails when the rule is missing while below the blocked major", () => {
    const problems = checkTypescriptIgnore("^6", [
      { dependencyName: "@types/node", updateTypes: [SEMVER_MAJOR] },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("found 0");
  });

  it("fails a rule with no update-types, which would ignore every version", () => {
    const problems = checkTypescriptIgnore("^6", [
      { dependencyName: "typescript", updateTypes: [] },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("update-types");
  });

  it("fails a rule that also ignores minor updates", () => {
    const problems = checkTypescriptIgnore("~6.0.3", [
      {
        dependencyName: "typescript",
        updateTypes: [SEMVER_MAJOR, "version-update:semver-minor"],
      },
    ]);
    expect(problems).toHaveLength(1);
  });

  it("demands removal once package.json reaches the blocked major", () => {
    const problems = checkTypescriptIgnore("^7", [majorRule]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("remove the typescript ignore rule");
  });

  it("passes with no rule once package.json reaches the blocked major", () => {
    expect(checkTypescriptIgnore("^7.0.2", [])).toEqual([]);
  });

  it("reports an unreadable range instead of passing it", () => {
    expect(checkTypescriptIgnore("latest", [majorRule])).toHaveLength(1);
  });
});

describe("readIgnoreRules", () => {
  it("attributes each ignore list to its own ecosystem and stops at the next key", () => {
    const text = [
      "version: 2",
      "updates:",
      '  - package-ecosystem: "npm"',
      '    directory: "/"',
      "    # a comment before the list",
      "    ignore:",
      '      - dependency-name: "typescript"',
      '        update-types: ["version-update:semver-major"]',
      "      # a comment inside the list",
      '      - dependency-name: "@types/node"',
      '        update-types: ["version-update:semver-major", "version-update:semver-minor"]',
      "    groups:",
      "      tooling:",
      '        patterns: ["typescript", "@types/node"]',
      '  - package-ecosystem: "github-actions"',
      '    directory: "/"',
      "    ignore:",
      '      - update-types: ["version-update:semver-patch"]',
      '        dependency-name: "actions/checkout"',
      "",
    ].join("\n");

    expect(readIgnoreRules(text)).toEqual({
      npm: [
        { dependencyName: "typescript", updateTypes: [SEMVER_MAJOR] },
        {
          dependencyName: "@types/node",
          updateTypes: [SEMVER_MAJOR, "version-update:semver-minor"],
        },
      ],
      "github-actions": [
        {
          dependencyName: "actions/checkout",
          updateTypes: ["version-update:semver-patch"],
        },
      ],
    });
  });

  it("returns an empty list for an entry with no ignore block", () => {
    const text = '  - package-ecosystem: "npm"\n    groups:\n      a:\n        patterns: ["*"]\n';
    expect(readIgnoreRules(text)).toEqual({ npm: [] });
  });
});
