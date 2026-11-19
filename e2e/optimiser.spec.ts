import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { gradeLogToOptimizerItems } from "@/lib/srs/optimizer";
import { syntheticGradeLog } from "@/lib/srs/syntheticGradeLog";

// The in-browser FSRS optimiser (D7 of openspec/changes/move-to-cloudflare).
// The page is cross-origin isolated so the threaded wasm binding can run; no
// other page is. Signed-in runs need a real account, so the fit itself is
// driven straight through the page's Web Worker with a synthetic log.

test.describe("FSRS optimiser page", () => {
  test.beforeEach(async ({ page }) => {
    await addOnboardingPreDismiss(page);
  });

  test("guest sees the signed-in-only state", async ({ page }) => {
    await page.goto("/settings/optimiser");
    await expect(page.getByRole("heading", { level: 1, name: "Personalise my schedule" })).toBeVisible();
    await expect(page.getByTestId("fsrs-optimiser-signed-out")).toHaveText(
      /Sign in to personalise your schedule/,
    );
    await expect(page.getByTestId("fsrs-optimiser-run")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to settings" })).toHaveAttribute("href", "/settings");
  });

  test("only the optimiser page is cross-origin isolated", async ({ page }) => {
    const response = await page.goto("/settings/optimiser");
    expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response?.headers()["cross-origin-embedder-policy"]).toBe("require-corp");
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);

    const settings = await page.goto("/settings");
    expect(settings?.headers()["cross-origin-embedder-policy"]).toBeUndefined();
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(false);
  });

  test("serves the worker and wasm as same-origin static assets with COEP", async ({ request }) => {
    for (const path of ["/fsrs/optimiser-worker.js", "/fsrs/wasi-thread.js", "/fsrs/fsrs-binding.wasm32-wasi.wasm"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["cross-origin-embedder-policy"], path).toBe("require-corp");
    }
  });

  test("the optimiser worker fits FSRS weights in this browser", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/settings/optimiser");
    const items = gradeLogToOptimizerItems(syntheticGradeLog({ days: 60, newPerDay: 8 }));
    const result = await page.evaluate(
      (items) =>
        new Promise<{ type: string; weights?: number[]; detail?: string }>((resolve) => {
          const worker = new Worker("/fsrs/optimiser-worker.js", { type: "module" });
          worker.onmessage = (e) => {
            if (e.data.type !== "progress") resolve(e.data);
          };
          worker.onerror = (e) => resolve({ type: "worker-error", detail: e.message });
          worker.postMessage({ type: "run", items });
        }),
      items,
    );
    expect(result.type, result.detail).toBe("done");
    expect(result.weights).toHaveLength(21);
    expect(result.weights?.every(Number.isFinite)).toBe(true);
  });
});
