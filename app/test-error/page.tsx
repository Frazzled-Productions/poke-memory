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
 *
 * In production (NEXT_PUBLIC_VERCEL_ENV==="production") the route returns a
 * 404 so it is never reachable by real users.
 */
"use client";

import { notFound } from "next/navigation";

export default function TestErrorPage(): never {
  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") notFound();
  throw new Error("Intentional test error - used by E2E smoke tests (#1533).");
}
