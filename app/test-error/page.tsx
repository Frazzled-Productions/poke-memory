/**
 * Minimal route that unconditionally throws so the root error boundary
 * (app/error.tsx) renders during E2E tests (#1533).
 *
 * This is a "use client" component so the error is caught by the nearest
 * error.tsx boundary rather than producing a server-side 500. Keeping it
 * client-side also avoids any server-only data-fetching concerns.
 *
 * The route is intentionally not linked from navigation. It exists solely as
 * a stable throw target for Playwright smoke tests.
 */
"use client";

export default function TestErrorPage(): never {
  throw new Error("Intentional test error — used by E2E smoke tests (#1533).");
}
