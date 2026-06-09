/**
 * Standalone service-worker build (issue #1752).
 *
 * Produces `public/sw/sw.js` (+ `.map`) as a TRUE static asset, so the worker
 * is served by Vercel's CDN rather than by a request-time serverless Route
 * Handler. The previous architecture (`app/sw/[path]/route.ts` via
 * `@serwist/turbopack`'s `createSerwistRoute`) ran the worker through a Next.js
 * function under `cacheComponents: true`, which the file-tracer left missing
 * `next/dist/server/config.js` - every request 500'd (#1749, hotfixed in #1751
 * by force-tracing the module; this script supersedes that hack).
 *
 * The registration URL is unchanged (`/sw/sw.js`), so no installed PWA needs to
 * re-register. The `Cache-Control: no-cache` + `Service-Worker-Allowed: /`
 * headers are applied to the static file by the `headers()` rule in
 * `next.config.ts`.
 *
 * Why a standalone script rather than a bundler plugin: this faithfully mirrors
 * `createSerwistRoute`'s build path (`node_modules/@serwist/turbopack/dist/index.mjs`),
 * reusing the very same `injectManifestOptions` validator/transform and
 * `getFileManifestEntries` so the precache manifest and esbuild output are
 * byte-equivalent to what the route used to emit. The ONLY difference is the
 * sink: files are written to `public/sw/` instead of held in memory and served
 * per-request.
 *
 * MUST run AFTER `next build` - the precache manifest reads the freshly-built
 * `.next/static` hashed asset URLs. Wired via the `build` script in package.json
 * (`next build && node scripts/build-sw.mjs`). For `next dev`, registration is
 * gated to production in `ServiceWorkerProvider`, so dev never needs this file;
 * `next start` after a build serves the generated static asset.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getFileManifestEntries, rebasePath } from "@serwist/build";
import { injectManifestOptions } from "@serwist/turbopack/schema";
import { browserslistToEsbuild } from "@serwist/utils";
import browserslist from "browserslist";
import { MODERN_BROWSERSLIST_TARGET } from "next/constants.js";
import * as esbuild from "esbuild";

const projectRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

// Make the script self-correcting regardless of the invoking directory. The
// Serwist schema resolves `config.cwd` from `process.cwd()`, and that cwd is
// what `getFileManifestEntries`, the `.next/static` glob, and esbuild's
// entryPoints/outdir all resolve against. `projectRoot` (from import.meta.url)
// is the only reliable anchor, so pin the process cwd to it up front: invoked
// from any subdirectory the globs would otherwise find nothing and the
// empty-manifest guard below would throw opaquely.
process.chdir(projectRoot);

/**
 * The same options object the route handler passed to `createSerwistRoute`.
 * Kept byte-identical to `app/sw/[path]/route.ts` (pre-removal) so the precache
 * scope, size cap, and esbuild flags do not drift. See that file's history for
 * the rationale behind each value.
 */
const ROUTE_OPTIONS = {
  swSrc: "app/sw.ts",
  useNativeEsbuild: true,
  globPatterns: [
    ".next/static/**/*.{js,css}",
    "public/*.{png,svg,ico,webmanifest}",
  ],
  globIgnores: ["**/sprites/**"],
  maximumFileSizeToCacheInBytes: 2 * 1024 * 1024, // 2 MiB
};

/**
 * Validate + resolve options exactly as `createSerwistRoute` does, then layer
 * on the same `manifestTransforms` wrapper it applies (rewriting distDir URLs
 * to `/_next/...` and `public/` URLs to the basePath root). This is a direct
 * port of the `validation` thenable in
 * `node_modules/@serwist/turbopack/dist/index.mjs`.
 */
async function resolveConfig() {
  const result = await injectManifestOptions.spa(ROUTE_OPTIONS);
  if (!result.success) {
    throw new Error(
      `[build-sw] invalid Serwist options:\n${JSON.stringify(result.error, null, 2)}`,
    );
  }
  const config = result.data;
  return {
    ...config,
    // Production build: keep the precache manifest (dev disables it, but this
    // script only ever runs post-`next build`).
    disablePrecacheManifest: false,
    globIgnores: [
      ...config.globIgnores,
      rebasePath({ file: config.swSrc, baseDirectory: config.globDirectory }),
    ],
    manifestTransforms: [
      ...(config.manifestTransforms ?? []),
      // Async to match the ResolvedManifestTransform signature getFileManifestEntries
      // awaits, even though this transform is synchronous.
      async (manifestEntries) => ({
        manifest: manifestEntries.map((m) => {
          if (m.url.startsWith(config.nextConfig.distDir)) {
            m.url = `${config.nextConfig.assetPrefix}/_next/${m.url.slice(config.nextConfig.distDir.length)}`;
          }
          if (m.url.startsWith("public/")) {
            m.url = path.posix.join(config.nextConfig.basePath, m.url.slice(7));
          }
          return m;
        }),
        warnings: [],
      }),
    ],
  };
}

async function main() {
  const config = await resolveConfig();

  const { count, size, manifestEntries } = await getFileManifestEntries(config);
  const injectionPoint = config.injectionPoint || "";
  const manifestString =
    manifestEntries === undefined ? "undefined" : JSON.stringify(manifestEntries, null, 2);

  console.log(
    `[build-sw] precache: ${String(count)} entries (${(size / 1024).toFixed(2)} KiB)`,
  );

  if (count === 0 || manifestEntries === undefined || manifestEntries.length === 0) {
    throw new Error(
      "[build-sw] precache manifest is empty - the .next build output was not found. " +
        "Run `next build` before this script.",
    );
  }

  // Bake a version string into the SW bundle so the Settings diagnostic can
  // detect a stale controlling worker (#1826). Format: "<appVersion>+<sha8>"
  // where sha8 is computed AFTER writing the bundle (see below). For the
  // define block we inject the app version only; the sha8 is appended later
  // via a second pass if needed. Here we use just the package version so the
  // frozen string is human-readable in the Settings UI.
  const pkgJson = JSON.parse(
    await fs.readFile(path.join(projectRoot, "package.json"), "utf-8"),
  );
  const appVersion = pkgJson.version ?? "dev";

  const result = await esbuild.build({
    sourcemap: true,
    format: "esm",
    treeShaking: true,
    minify: true,
    bundle: true,
    ...config.esbuildOptions,
    target:
      config.esbuildOptions?.target ??
      browserslistToEsbuild(browserslist, config.cwd, MODERN_BROWSERSLIST_TARGET),
    platform: "browser",
    define: {
      ...config.esbuildOptions?.define,
      ...(injectionPoint ? { [injectionPoint]: manifestString } : {}),
      // Inject the frozen SW version string. esbuild replaces the identifier
      // `self.__SW_VERSION__` (declared in app/sw.ts) with this literal at
      // bundle time so the value is frozen into each deployed worker.
      "self.__SW_VERSION__": JSON.stringify(appVersion),
    },
    outdir: config.cwd,
    write: false,
    entryNames: "[name]",
    assetNames: "[name]-[hash]",
    chunkNames: "[name]-[hash]",
    entryPoints: [{ in: config.swSrc, out: "sw" }],
  });

  if (result.errors.length) {
    console.error("[build-sw] esbuild failed:", result.errors);
    throw new Error("[build-sw] service worker bundle failed");
  }
  if (result.warnings.length) {
    console.warn("[build-sw] esbuild warnings:", result.warnings);
  }

  const outDir = path.join(projectRoot, "public", "sw");
  await fs.mkdir(outDir, { recursive: true });

  let wroteWorker = false;
  for (const file of result.outputFiles) {
    const base = path.basename(file.path); // "sw.js" or "sw.js.map"
    if (base !== "sw.js" && base !== "sw.js.map") continue;
    const dest = path.join(outDir, base);
    await fs.writeFile(dest, file.contents);
    if (base === "sw.js") wroteWorker = true;
    console.log(
      `[build-sw] wrote ${path.relative(projectRoot, dest)} (${(file.contents.byteLength / 1024).toFixed(2)} KiB)`,
    );
  }

  if (!wroteWorker) {
    throw new Error("[build-sw] esbuild did not emit sw.js");
  }

  // Sanity-check the emitted worker actually carries a precache manifest and
  // the worker logic, not an empty shell. The minified manifest array uses the
  // hashed `/_next/static/...` URLs.
  const swPath = path.join(outDir, "sw.js");
  const swBody = await fs.readFile(swPath, "utf-8");
  if (!swBody.includes("/_next/")) {
    throw new Error(
      "[build-sw] emitted sw.js does not reference any /_next/ precache URLs - " +
        "the manifest injection failed.",
    );
  }
  const hash = crypto.createHash("sha256").update(swBody).digest("hex").slice(0, 12);
  console.log(`[build-sw] sw.js sha256:${hash} - manifest injected, OK.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
