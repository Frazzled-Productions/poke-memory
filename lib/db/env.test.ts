import { afterEach, describe, expect, it, vi } from "vitest";

const { getCloudflareContext } = vi.hoisted(() => ({ getCloudflareContext: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext }));

import { getDb, getEnv } from "./env";

afterEach(() => getCloudflareContext.mockReset());

describe("getEnv / getDb", () => {
  it("reads the bindings through getCloudflareContext({ async: true })", async () => {
    const DB = { prepare: vi.fn() };
    getCloudflareContext.mockResolvedValue({ env: { DB, DEPLOY_ENV: "cloudflare-preview" } });
    expect((await getEnv()).DEPLOY_ENV).toBe("cloudflare-preview");
    expect(await getDb()).toBe(DB);
    expect(getCloudflareContext).toHaveBeenCalledWith({ async: true });
  });

  it("throws a clear error without a D1 binding", async () => {
    getCloudflareContext.mockResolvedValue({ env: {} });
    await expect(getDb()).rejects.toThrow(/No D1 binding `DB`/);
  });
});
