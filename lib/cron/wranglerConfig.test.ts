/**
 * wrangler.jsonc against lib/cron/schedule.ts (design D2): every production
 * Cron Trigger must be one cronRoutesFor maps to routes, or the monthly
 * restore check (design D10), or that firing would run nothing; the preview
 * Worker must have no triggers and its own DEPLOY_ENV, so the rehearsal copy
 * of real data never sends anything, and no backups bucket, because preview
 * versions run pull request code (deploy guard, ops #610).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESTORE_CHECK_CRON, cronRoutesFor } from "./schedule";

/** JSON with // and block comments removed, leaving strings (URLs) alone. */
function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out);
}

type WorkerConfig = {
  triggers?: { crons?: string[] };
  vars?: Record<string, string>;
  r2_buckets?: { binding: string; bucket_name: string; jurisdiction?: string }[];
};
const config = parseJsonc(readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8")) as WorkerConfig & {
  env: { preview: WorkerConfig };
};

describe("wrangler.jsonc Cron Triggers", () => {
  it("production has triggers, and each is a cron string cronRoutesFor knows", () => {
    const crons = config.triggers?.crons ?? [];
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons.filter((c) => c !== RESTORE_CHECK_CRON)) {
      const knows = Array.from({ length: 24 }, (_, hour) =>
        cronRoutesFor(cron, new Date(Date.UTC(2026, 10, 16, hour, 0))),
      ).some((routes) => routes.length > 0);
      expect(knows, `cron "${cron}" maps to no routes at any hour`).toBe(true);
    }
  });

  it("production runs the monthly restore check (04:00 UTC on the 1st)", () => {
    expect(RESTORE_CHECK_CRON).toBe("0 4 1 * *");
    expect(config.triggers?.crons).toContain(RESTORE_CHECK_CRON);
  });

  it("production runs as cloudflare-production", () => {
    expect(config.vars?.DEPLOY_ENV).toBe("cloudflare-production");
  });

  it("the preview Worker has no crons and DEPLOY_ENV cloudflare-preview", () => {
    expect(config.env.preview.triggers).toEqual({ crons: [] });
    expect(config.env.preview.vars?.DEPLOY_ENV).toBe("cloudflare-preview");
  });

  it("the preview Worker's sign-in base URL is qa.pokememory.com, its Worker Custom Domain", () => {
    expect(config.env.preview.vars?.BETTER_AUTH_URL).toBe("https://qa.pokememory.com");
  });
});

describe("wrangler.jsonc backups bucket (design D10)", () => {
  it("production binds BACKUPS to the EU bucket poke-memory-backups, with its key prefix", () => {
    expect(config.r2_buckets).toEqual([{ binding: "BACKUPS", bucket_name: "poke-memory-backups", jurisdiction: "eu" }]);
    expect(config.vars?.D1_BACKUP_PREFIX).toBe("d1/poke-memory");
  });

  it("the preview Worker gets no bucket binding and no prefix", () => {
    expect(config.env.preview.r2_buckets ?? []).toEqual([]);
    expect(config.env.preview.vars?.D1_BACKUP_PREFIX).toBeUndefined();
  });
});

describe("wrangler.jsonc alert sender (design D13)", () => {
  it("production sends alerts from a frazzledproductions.com address, the domain verified in Resend", () => {
    expect(config.vars?.RESEND_FROM).toBe("Poké Memory <hello@frazzledproductions.com>");
  });

  it("the preview Worker has no alert sender (it runs no crons and gets no Resend key)", () => {
    expect(config.env.preview.vars?.RESEND_FROM).toBeUndefined();
  });
});

describe("wrangler.jsonc secrets (Discord dropped for email, 20 November 2026)", () => {
  it("lists no Discord webhook secret: the feedback alert and digest email through Resend", () => {
    const text = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    expect(text).not.toMatch(/DISCORD/);
    expect(text).toMatch(/RESEND_API_KEY/);
  });
});
