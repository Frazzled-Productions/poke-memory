import { describe, expect, it } from "vitest";
import { outboundAllowed } from "./outbound";

describe("outboundAllowed", () => {
  it("allows only the production Worker", () => {
    expect(outboundAllowed({ DEPLOY_ENV: "cloudflare-production" })).toBe(true);
  });

  it.each([["cloudflare-preview"], ["vercel-production"], [""], ["Cloudflare-Production"]])(
    "refuses DEPLOY_ENV=%j",
    (value) => {
      expect(outboundAllowed({ DEPLOY_ENV: value })).toBe(false);
    },
  );

  it("refuses when DEPLOY_ENV is missing (local dev, tests)", () => {
    expect(outboundAllowed({})).toBe(false);
  });
});
