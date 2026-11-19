/**
 * wrangler.jsonc against lib/cron/schedule.ts (design D2): every production
 * Cron Trigger must be one cronRoutesFor maps to routes, or that firing would
 * run nothing; the preview Worker must have no triggers and its own
 * DEPLOY_ENV, so the rehearsal copy of real data never sends anything.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cronRoutesFor } from "./schedule";

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

type WorkerConfig = { triggers?: { crons?: string[] }; vars?: Record<string, string> };
const config = parseJsonc(readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8")) as WorkerConfig & {
  env: { preview: WorkerConfig };
};

describe("wrangler.jsonc Cron Triggers", () => {
  it("production has triggers, and each is a cron string cronRoutesFor knows", () => {
    const crons = config.triggers?.crons ?? [];
    expect(crons.length).toBeGreaterThan(0);
    for (const cron of crons) {
      const knows = Array.from({ length: 24 }, (_, hour) =>
        cronRoutesFor(cron, new Date(Date.UTC(2026, 10, 16, hour, 0))),
      ).some((routes) => routes.length > 0);
      expect(knows, `cron "${cron}" maps to no routes at any hour`).toBe(true);
    }
  });

  it("production runs as cloudflare-production", () => {
    expect(config.vars?.DEPLOY_ENV).toBe("cloudflare-production");
  });

  it("the preview Worker has no crons and DEPLOY_ENV cloudflare-preview", () => {
    expect(config.env.preview.triggers).toEqual({ crons: [] });
    expect(config.env.preview.vars?.DEPLOY_ENV).toBe("cloudflare-preview");
  });
});
