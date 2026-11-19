import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import TestErrorPage from "./page";

describe("/test-error", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a 404 on the production Worker", () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "cloudflare-production");
    expect(() => TestErrorPage()).toThrow("NEXT_NOT_FOUND");
  });

  it("throws its intentional error everywhere else, previews included", () => {
    vi.stubEnv("NEXT_PUBLIC_DEPLOY_ENV", "cloudflare-preview");
    expect(() => TestErrorPage()).toThrow(/Intentional test error/);
  });
});
