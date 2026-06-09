/**
 * Next.js instrumentation hook (stable in Next 15 / 16).
 *
 * Loaded once per server start (or cold Edge invocation). The `register()`
 * function is the standard entry point for initialising observability tooling
 * before the app handles its first request.
 *
 * Runtime-specific SDKs are imported dynamically to avoid the Node SDK ever
 * being bundled into Edge workers (which lack Node-only APIs the Node SDK
 * uses).
 *
 * `onRequestError` is a Next 15.3+ stable hook. Next.js calls it for every
 * unhandled error thrown inside a Route Handler, Server Component, or Server
 * Action before the response is sent. Expected control-flow throws
 * (`notFound()`, `redirect()`) are filtered by `shouldCapture` so they do
 * not appear as spurious Sentry issues.
 */
import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";
import { shouldCapture } from "@/lib/observability/shouldCapture";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./instrumentation-edge");
  }
}

export const onRequestError: Instrumentation.onRequestError = function onRequestError(
  error,
  request,
  context,
) {
  if (!shouldCapture(error)) return;
  Sentry.captureRequestError(error, request, context);
};
