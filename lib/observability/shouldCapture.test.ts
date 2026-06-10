/**
 * Unit tests for lib/observability/shouldCapture.ts.
 *
 * Verifies that Next.js internal control-flow throws (notFound, redirect) are
 * skipped, while genuine unhandled errors are forwarded to Sentry.
 *
 * The sentinel digest format matches Next.js internals:
 *   - "NEXT_HTTP_ERROR_FALLBACK;<code>" for notFound() and related helpers
 *   - "NEXT_REDIRECT;<type>;<url>;<code>;" for redirect() / permanentRedirect()
 */

import { describe, it, expect } from "vitest";
import { shouldCapture } from "./shouldCapture";

// ---------------------------------------------------------------------------
// Helpers to build sentinel errors that match Next.js internals
// ---------------------------------------------------------------------------

function notFoundError(): Error & { digest: string } {
  return Object.assign(new Error("not found"), {
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });
}

function redirectError(url = "/home"): Error & { digest: string } {
  return Object.assign(new Error("redirect"), {
    digest: `NEXT_REDIRECT;replace;${url};307;`,
  });
}

function permanentRedirectError(url = "/new"): Error & { digest: string } {
  return Object.assign(new Error("permanent redirect"), {
    digest: `NEXT_REDIRECT;replace;${url};308;`,
  });
}

// ---------------------------------------------------------------------------
// Next.js control-flow throws - should NOT be captured
// ---------------------------------------------------------------------------

describe("shouldCapture - Next.js internal throws (skip)", () => {
  it("skips notFound() errors (NEXT_HTTP_ERROR_FALLBACK;404)", () => {
    expect(shouldCapture(notFoundError())).toBe(false);
  });

  it("skips redirect() errors (NEXT_REDIRECT;replace;...;307;)", () => {
    expect(shouldCapture(redirectError())).toBe(false);
  });

  it("skips permanentRedirect() errors (NEXT_REDIRECT;replace;...;308;)", () => {
    expect(shouldCapture(permanentRedirectError())).toBe(false);
  });

  it("skips any NEXT_HTTP_ERROR_FALLBACK variant (future HTTP error codes)", () => {
    const error = Object.assign(new Error("forbidden"), {
      digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    });
    expect(shouldCapture(error)).toBe(false);
  });

  it("skips NEXT_REDIRECT with a push type", () => {
    const error = Object.assign(new Error("redirect push"), {
      digest: "NEXT_REDIRECT;push;/elsewhere;307;",
    });
    expect(shouldCapture(error)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Genuine unhandled errors - MUST be captured
// ---------------------------------------------------------------------------

describe("shouldCapture - real errors (capture)", () => {
  it("captures a plain Error with no digest", () => {
    expect(shouldCapture(new Error("oops"))).toBe(true);
  });

  it("captures an Error with an unrecognised digest", () => {
    const error = Object.assign(new Error("db error"), { digest: "SOME_OTHER_CODE" });
    expect(shouldCapture(error)).toBe(true);
  });

  it("captures a thrown string", () => {
    expect(shouldCapture("something bad")).toBe(true);
  });

  it("captures null", () => {
    expect(shouldCapture(null)).toBe(true);
  });

  it("captures undefined", () => {
    expect(shouldCapture(undefined)).toBe(true);
  });

  it("captures an object with no digest property", () => {
    expect(shouldCapture({ message: "no digest" })).toBe(true);
  });

  it("captures an object where digest is not a string", () => {
    expect(shouldCapture({ digest: 404 })).toBe(true);
  });

  it("captures a TypeError", () => {
    expect(shouldCapture(new TypeError("cannot read property of undefined"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SDK inert when DSN is absent
// ---------------------------------------------------------------------------

describe("shouldCapture - inert-DSN safety", () => {
  // This test documents the expectation that shouldCapture itself never throws,
  // so the instrumentation path is safe regardless of DSN availability.
  it("does not throw for any input", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      0,
      "",
      true,
      new Error("x"),
      notFoundError(),
      redirectError(),
      { digest: "NEXT_REDIRECT;push;/x;307;" },
    ];
    for (const input of inputs) {
      expect(() => shouldCapture(input)).not.toThrow();
    }
  });
});
