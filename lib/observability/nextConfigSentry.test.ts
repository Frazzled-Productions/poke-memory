/**
 * Guard for the Sentry build options in next.config.ts (#2076).
 *
 * The production build runs on Turbopack (a plain `next build` on Next 16),
 * and @sentry/nextjs ignores everything under its `webpack` options key when
 * Turbopack is the bundler, without a warning. #2076 found
 * `webpack.treeshake.removeDebugLogging` sitting there doing nothing while its
 * comment said it stripped the SDK's debug logging. These tests fail if a
 * `webpack` key comes back, and pin the premises the next.config.ts comment
 * relies on: the build uses Turbopack, and source maps upload through Sentry's
 * `runAfterProductionCompile` hook.
 *
 * next.config.ts is imported for real, with `withSentryConfig` and the
 * next-intl plugin mocked at the module boundary, so the assertions read the
 * options object the config actually passes rather than matching its source
 * text. The test lives under lib/ because the node vitest project only
 * collects tests from lib/ and scripts/.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import type { withSentryConfig } from "@sentry/nextjs";
import pkg from "@/package.json";

type SentryBuildOptions = NonNullable<Parameters<typeof withSentryConfig>[1]>;

// ---------------------------------------------------------------------------
// Mock setup: vi.hoisted() creates the spy before the hoisted vi.mock
// factories run.
// ---------------------------------------------------------------------------

const { mockWithSentryConfig } = vi.hoisted(() => ({
  mockWithSentryConfig: vi.fn((...args: unknown[]) => args[0]),
}));

vi.mock("@sentry/nextjs", () => ({
  withSentryConfig: mockWithSentryConfig,
}));

vi.mock("next-intl/plugin", () => ({
  default: () => (config: unknown) => config,
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

describe("next.config.ts Sentry build options (#2076)", () => {
  let options: SentryBuildOptions;

  beforeAll(async () => {
    await import("@/next.config");
    expect(mockWithSentryConfig).toHaveBeenCalledTimes(1);
    options = mockWithSentryConfig.mock.calls[0][1] as SentryBuildOptions;
  });

  it("builds with Turbopack, because the build script does not opt into webpack", () => {
    const message =
      "the build script now selects a bundler: revisit the BUNDLER note in next.config.ts";
    expect(pkg.scripts.build, message).toMatch(/\bnext build\b/);
    expect(pkg.scripts.build, message).not.toContain("--webpack");
  });

  it("passes no webpack options, which Turbopack builds ignore without a warning", () => {
    expect(
      options,
      "options under `webpack` do nothing under Turbopack: use a Turbopack-aware option instead",
    ).not.toHaveProperty("webpack");
  });

  // Only a real build shows the hook running; this guards against the config
  // switching it off, which stops Turbopack builds uploading source maps.
  it("does not switch off the runAfterProductionCompile source-map upload hook", () => {
    expect(options.useRunAfterProductionCompileHook).not.toBe(false);
    expect(options.sourcemaps?.disable).not.toBe(true);
  });
});
