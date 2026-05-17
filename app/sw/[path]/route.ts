/**
 * Serwist Turbopack route handler.
 *
 * `@serwist/turbopack` builds the service worker through a Next.js Route
 * Handler instead of a bundler plugin, so Next.js 16's default Turbopack stays
 * in place (no `--webpack` regression). At build time `createSerwistRoute`
 * bundles `app/sw.ts` with esbuild, injects the precache manifest, and exposes
 * the output as static files under this segment:
 *
 *   - `/sw/sw.js`     — the bundled service worker the client registers
 *   - `/sw/sw.js.map` — its source map
 *
 * The segment is `[path]` (a single dynamic segment), because esbuild emits
 * every asset at the top level with a deterministic name.
 *
 * The handler also sets `Service-Worker-Allowed: /`, so the worker registered
 * from `/sw/sw.js` may claim the whole-site scope `/`.
 *
 * Precaching scope: the manifest covers ONLY the app shell — the Next.js
 * static JS/CSS build output. The `public/sprites/**` directory (~1174 files,
 * ~170 MB) is deliberately excluded: precaching it would force a 170 MB
 * download on first install. Sprites are runtime-cached cache-first on first
 * view instead (see lib/pwa/cacheStrategy.ts). Large individual build chunks
 * are also skipped via `maximumFileSizeToCacheInBytes` and fall back to the
 * cache-first static handler at runtime.
 */
import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    // The service-worker source bundled into `/sw/sw.js`.
    swSrc: "app/sw.ts",
    // Precache only the static build output (the app shell). The default
    // patterns also glob `public/**/*`, which would pull in every sprite.
    globPatterns: [
      ".next/static/**/*.{js,css,html,ico,json,webmanifest}",
      "public/*.{png,svg,ico,webmanifest}",
    ],
    // Belt and braces: even if a sprite path slipped through, ignore it.
    globIgnores: ["**/sprites/**"],
    // Skip oversized chunks from the precache; they are runtime-cached
    // cache-first on first use instead of bloating the install payload.
    maximumFileSizeToCacheInBytes: 2 * 1024 * 1024, // 2 MiB
  });
