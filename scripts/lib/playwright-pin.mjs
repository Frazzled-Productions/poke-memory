/**
 * Pure helpers for the Playwright image-pin drift check (#2074).
 *
 * The Playwright version lives in two places that must agree: the
 * `@playwright/test` version locked in package-lock.json, and every
 * `mcr.microsoft.com/playwright:vX.Y.Z-<distro>` image tag (the CI workflow
 * containers plus the copies in scripts and docs). Dependabot's npm entry bumps
 * only the first, and its github-actions entry never touches `container.image`,
 * so a bump used to arrive half-done and fail every browser job with a wall of
 * "Executable doesn't exist" errors (#2035). scripts/check-playwright-pin.mjs
 * feeds these helpers so the mismatch fails `npm run lint` with a named error.
 *
 * Imports nothing, so it runs under plain `node` and in the vitest node project.
 */

/** Matches a Playwright image tag and captures its X.Y.Z version. */
export const PLAYWRIGHT_IMAGE_TAG = /playwright:v(\d+\.\d+\.\d+)/g;

/**
 * The lockfile entries that must all resolve to the same version. The image
 * ships browsers for exactly one playwright-core build, so all three matter.
 */
const LOCKED_PACKAGES = [
  "node_modules/@playwright/test",
  "node_modules/playwright",
  "node_modules/playwright-core",
];

/**
 * Reads the locked Playwright version from a parsed package-lock.json.
 *
 * @param {{ packages?: Record<string, { version?: string }> }} lock
 * @returns {{ version: string | null, errors: string[] }}
 */
export function lockedPlaywrightVersion(lock) {
  const packages = lock.packages ?? {};
  const testEntry = packages[LOCKED_PACKAGES[0]];
  if (!testEntry?.version) {
    return {
      version: null,
      errors: [
        `package-lock.json has no locked version for ${LOCKED_PACKAGES[0]}.`,
      ],
    };
  }
  const version = testEntry.version;
  /** @type {string[]} */
  const errors = [];
  for (const key of LOCKED_PACKAGES.slice(1)) {
    const locked = packages[key]?.version;
    if (locked !== version) {
      errors.push(
        `package-lock.json locks ${key} at ${locked ?? "(missing)"}, but @playwright/test at ${version}.`,
      );
    }
  }
  return { version, errors };
}

/**
 * Finds every Playwright image tag that disagrees with the locked version.
 *
 * @param {{ path: string, text: string }[]} files
 * @param {string} version the locked @playwright/test version
 * @returns {string[]} one message per mismatching tag, as `path:line ...`
 */
export function findImageTagDrift(files, version) {
  /** @type {string[]} */
  const errors = [];
  for (const { path, text } of files) {
    text.split("\n").forEach((line, idx) => {
      for (const m of line.matchAll(PLAYWRIGHT_IMAGE_TAG)) {
        if (m[1] !== version) {
          errors.push(
            `${path}:${idx + 1} pins playwright:v${m[1]}, but package-lock.json locks @playwright/test ${version}.`,
          );
        }
      }
    });
  }
  return errors;
}
