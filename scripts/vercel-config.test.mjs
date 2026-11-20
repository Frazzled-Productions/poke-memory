/**
 * vercel.json stays, with every Git deployment off, until the 14-day Vercel
 * fallback after the move to Cloudflare ends (move-to-cloudflare). Without the
 * file, a still-connected Vercel Git integration falls back to its default,
 * "deploy every branch, main to production", so the qa-to-main promotion would
 * rebuild pokememory.com on Vercel from code that needs Cloudflare.
 *
 * It lives under scripts/ because it guards deploy config, not product code.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("vercel.json", () => {
  it("exists and turns off every Git deployment, main included", () => {
    const path = resolve(repoRoot, "vercel.json");
    expect(existsSync(path)).toBe(true);
    const config = JSON.parse(readFileSync(path, "utf8"));
    expect(config.git).toEqual({ deploymentEnabled: false });
  });

  it("does not bring back the ignored-build script", () => {
    const config = JSON.parse(readFileSync(resolve(repoRoot, "vercel.json"), "utf8"));
    expect(config.ignoreCommand).toBeUndefined();
    expect(existsSync(resolve(repoRoot, "scripts/vercel-ignored-build.sh"))).toBe(false);
  });
});
