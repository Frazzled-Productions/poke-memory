/**
 * Serwist Turbopack route handler.
 *
 * `@serwist/turbopack` builds the service worker through a Next.js Route
 * Handler instead of a bundler plugin, so Next.js 16's default Turbopack stays
 * in place (no `--webpack` regression). At build time `createSerwistRoute`
 * bundles `app/sw.ts` with esbuild, injects the precache manifest, and exposes
 * the output as static files under this segment:
 *
 *   - `/sw/sw.js` - the bundled service worker the client registers
 *   - `/sw/sw.js.map` - its source map
 *
 * The segment is `[path]` (a single dynamic segment), because esbuild emits
 * every asset at the top level with a deterministic name.
 *
 * The handler also sets `Service-Worker-Allowed: /`, so the worker registered
 * from `/sw/sw.js` may claim the whole-site scope `/`.
 *
 * Precaching scope: the manifest covers ONLY the app shell - the Next.js
 * static JS/CSS build output. The `public/sprites/**` directory (~1174 files,
 * ~170 MB) is deliberately excluded: precaching it would force a 170 MB
 * download on first install. Sprites are runtime-cached cache-first on first
 * view instead (see lib/pwa/cacheStrategy.ts). Large individual build chunks
 * are also skipped via `maximumFileSizeToCacheInBytes` and fall back to the
 * cache-first static handler at runtime.
 *
 * esbuild note: `useNativeEsbuild: true` switches the service-worker bundler
 * from esbuild-wasm to native esbuild. The wasm variant spawns a long-lived
 * child process speaking a binary stdio protocol. When the Next.js build
 * finishes and the parent tears down, the wasm child can still be mid-write to
 * the now-closed pipe, producing a spurious "Error: write EPIPE" in stderr.
 * Native esbuild handles process teardown cleanly and is also significantly
 * faster. The `esbuild` package is a build-time devDependency whose
 * platform-specific binary is managed automatically by npm.
 */
import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    // The service-worker source bundled into `/sw/sw.js`.
    swSrc: "app/sw.ts",
    // Use native esbuild instead of esbuild-wasm to avoid a spurious EPIPE
    // during build teardown. See the module comment above.
    useNativeEsbuild: true,
    // Precache only the static build output (the app shell). The default
    // patterns also glob `public/**/*`, which would pull in every sprite.
    //
    // The build-output glob is restricted to `*.{js,css}` on purpose. A
    // wider extension list (e.g. `json`) pulls `.next/static/` RSC payloads
    // and route metadata into the precache - those change every deploy and
    // stale instantly, bloating the install for no benefit. HTML documents
    // and other build assets are covered by the NetworkFirst runtime handler
    // instead. Root-level `public/` files (the web manifest, favicons) are
    // genuinely small and stable, so they stay precached.
    globPatterns: [
      ".next/static/**/*.{js,css}",
      "public/*.{png,svg,ico,webmanifest}",
    ],
    // Belt and braces: even if a sprite path slipped through, ignore it.
    globIgnores: ["**/sprites/**"],
    // Skip oversized chunks from the precache; they are runtime-cached
    // cache-first on first use instead of bloating the install payload.
    maximumFileSizeToCacheInBytes: 2 * 1024 * 1024, // 2 MiB
  });
