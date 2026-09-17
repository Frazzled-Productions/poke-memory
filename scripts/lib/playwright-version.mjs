// Pure helpers for the Playwright image drift check (#2074). The CLI
// (scripts/check-playwright-version-drift.mjs) does the file reading; this
// module only inspects text and parsed JSON, so it is unit-testable.
//
// Why the check exists: the Playwright version is recorded in two places that
// must agree. package-lock.json locks `@playwright/test`, and the browser jobs
// run inside `mcr.microsoft.com/playwright` containers whose tag names a
// Playwright release. Each image ships browsers for exactly one release, so a
// lockfile that moves without the tags fails every browser job with
// "Executable doesn't exist". Dependabot only moves the lockfile, which is how
// #2035 arrived half-done.
//
// Contract:
//   - The single source of truth is the `@playwright/test` version in
//     package-lock.json. `playwright` and `playwright-core` must be locked to the
//     same version (the browser build is keyed to playwright-core).
//   - Every `mcr.microsoft.com/playwright:<tag>` reference in a scanned file must
//     use exactly `v<locked version>-noble`. A floating tag (`latest`), a partial
//     version (`v1.62`), an empty tag or another distro suffix is drift too.
//   - A bare `mcr.microsoft.com/playwright` with no `:` is prose and is ignored.
//   - The workflows must contain at least one reference, so the check cannot
//     pass on nothing if the browser jobs are ever restructured.

export const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright";
export const PLAYWRIGHT_IMAGE_DISTRO = "noble";

// The lockfile entries that must all carry the same version.
const LOCK_PACKAGES = [
  "node_modules/@playwright/test",
  "node_modules/playwright",
  "node_modules/playwright-core",
];

// `mcr.microsoft.com/playwright:` followed by the Docker tag characters. The
// capture stops at anything a tag cannot contain (whitespace, quotes,
// backticks, `@` before a digest, `<` in a placeholder), so the captured tag is
// exactly what Docker would pull.
const IMAGE_REFERENCE = /mcr\.microsoft\.com\/playwright:([\w.-]*)/g;

const PINNED_TAG = /^v(\d+\.\d+\.\d+)-([a-z0-9]+)$/;

/**
 * The only image tag allowed for a given locked Playwright version.
 *
 * @param {string} version e.g. "1.62.1"
 * @returns {string} e.g. "v1.62.1-noble"
 */
export function expectedImageTag(version) {
  return `v${version}-${PLAYWRIGHT_IMAGE_DISTRO}`;
}

/**
 * Read the locked Playwright version from a parsed package-lock.json.
 *
 * @param {any} lock Parsed package-lock.json (lockfileVersion 2 or 3).
 * @returns {{ ok: true, version: string } | { ok: false, problems: string[] }}
 */
export function lockedPlaywrightVersion(lock) {
  const packages = lock && typeof lock === "object" ? lock.packages : undefined;
  if (!packages || typeof packages !== "object") {
    return {
      ok: false,
      problems: [
        "package-lock.json has no `packages` map (lockfileVersion 2 or later is required)",
      ],
    };
  }

  const problems = [];
  const versions = LOCK_PACKAGES.map((key) => {
    const version = packages[key]?.version;
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
      problems.push(`package-lock.json has no locked version for \`${key}\``);
      return undefined;
    }
    return version;
  });
  if (problems.length > 0) return { ok: false, problems };

  const [version, ...rest] = versions;
  rest.forEach((other, i) => {
    if (other !== version) {
      problems.push(
        `package-lock.json locks \`${LOCK_PACKAGES[i + 1]}\` at ${other} but ` +
          `\`${LOCK_PACKAGES[0]}\` at ${version}; they must match`,
      );
    }
  });
  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, version };
}

/**
 * Explain why a tag is not the expected one.
 *
 * @param {string} tag
 * @param {string} version
 */
function driftReason(tag, version) {
  const pinned = tag.match(PINNED_TAG);
  if (!pinned) return "not a pinned vX.Y.Z-noble tag";
  if (pinned[1] !== version) return `Playwright ${pinned[1]} instead of ${version}`;
  return `the -${pinned[2]} variant instead of -${PLAYWRIGHT_IMAGE_DISTRO}`;
}

/**
 * Scan files line by line for Playwright image references and report every
 * one that does not match the locked version.
 *
 * @param {{
 *   version: string,
 *   workflows: { path: string, content: string }[],
 *   others?: { path: string, content: string }[],
 * }} input `workflows` must contain at least one reference; `others` (docs,
 *   scripts) may contain none.
 * @returns {{
 *   references: { path: string, line: number, tag: string }[],
 *   problems: string[],
 * }}
 */
export function findImageTagDrift({ version, workflows, others = [] }) {
  const expected = expectedImageTag(version);
  const references = [];
  const problems = [];
  let workflowReferences = 0;

  const scan = (file, isWorkflow) => {
    file.content.split(/\r?\n/).forEach((text, idx) => {
      for (const match of text.matchAll(IMAGE_REFERENCE)) {
        const tag = match[1];
        references.push({ path: file.path, line: idx + 1, tag });
        if (isWorkflow) workflowReferences++;
        if (tag !== expected) {
          problems.push(
            `${file.path}:${idx + 1} uses ${PLAYWRIGHT_IMAGE}:${tag || "(empty tag)"} ` +
              `(${driftReason(tag, version)}); expected ${PLAYWRIGHT_IMAGE}:${expected}`,
          );
        }
      }
    });
  };

  for (const file of workflows) scan(file, true);
  for (const file of others) scan(file, false);

  if (workflowReferences === 0) {
    problems.push(
      `no ${PLAYWRIGHT_IMAGE} image reference with a tag was found in any workflow, ` +
        "so this check would pass on nothing; if the browser jobs have moved, " +
        "update scripts/check-playwright-version-drift.mjs to scan their new home",
    );
  }

  return { references, problems };
}
