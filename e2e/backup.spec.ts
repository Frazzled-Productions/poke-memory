import { test, expect, type Page } from "@playwright/test";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

// ---------------------------------------------------------------------------
// Backup section helpers
// ---------------------------------------------------------------------------

/**
 * Navigates to /settings and expands the "Account & Data" section, which
 * houses the Backup sub-section.
 */
async function openBackupSection(page: Page) {
  await page.goto("/settings");
  await expect(page.getByLabel("Loading settings")).toBeHidden();
  await page.getByRole("button", { name: /account & data/i, exact: true }).click();
}

// ---------------------------------------------------------------------------
// Minimal valid backup payload.
//
// ID 1 (Bulbasaur) is always present in SEED_POKEMON; it passes the
// validateBackup() ID-whitelist check. The settings shape must satisfy
// isSettingsShaped() in lib/backup/schema.ts.
// ---------------------------------------------------------------------------
const MINIMAL_BACKUP = {
  version: 1,
  exportedAt: "2026-01-01T00:00:00.000Z",
  cards: [
    {
      id: 1,
      name: "Bulbasaur",
      spriteUrl: "/sprites/pokemon/1.png",
      cardType: "name",
      state: {
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        fsrsState: "new",
        dueDate: "2026-01-01",
        lastReview: null,
        firstSeen: null,
        learningStep: null,
        stepStartedAt: null,
      },
    },
  ],
  limits: {
    name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
    reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
    cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
  },
  settings: {
    masteryRepetitions: 3,
    maxNewPerDay: 10,
    maxReviewsPerDay: 100,
    maxNewEvolutionPerDay: 5,
    maxReviewsEvolutionPerDay: 50,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Backup section — export (#766)", () => {
  test("Export button is visible inside Account & Data", async ({ page }) => {
    await openBackupSection(page);

    // The backup sub-section heading must be present.
    await expect(page.getByText("Backup", { exact: true })).toBeVisible();

    // The Export button must be visible and enabled.
    await expect(
      page.getByRole("button", { name: /^export$/i }),
    ).toBeVisible();
  });

  test("clicking Export initiates a file download without a page error", async ({
    page,
    browserName,
  }) => {
    // Download interception is only reliable in Chromium; skip other engines
    // to avoid flakiness — the button-visibility test above covers presence.
    test.skip(
      browserName !== "chromium",
      "download assertion is Chromium-only",
    );

    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await openBackupSection(page);

    // Listen for the download event, then click Export.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^export$/i }).click(),
    ]);

    // The downloaded file must have the expected naming convention.
    expect(download.suggestedFilename()).toMatch(/^poke-memory-backup-\d{4}-\d{2}-\d{2}\.json$/);

    // No uncaught page errors must have occurred.
    expect(pageErrors).toHaveLength(0);
  });
});

test.describe("Backup section — import (#766)", () => {
  test("Import button is visible inside Account & Data", async ({ page }) => {
    await openBackupSection(page);

    await expect(
      page.getByRole("button", { name: /^import$/i }),
    ).toBeVisible();
  });

  test("importing a valid backup file shows a confirmation dialog then reloads", async ({
    page,
    browserName,
  }) => {
    // File-chooser interception is only reliable in Chromium.
    test.skip(
      browserName !== "chromium",
      "file-chooser interception is Chromium-only",
    );

    await openBackupSection(page);

    // Accept the window.confirm() that handleImport shows before applying.
    page.once("dialog", (dialog) => dialog.accept());

    // Trigger the hidden file input via the Import button and supply a
    // valid backup file constructed in memory.
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /^import$/i }).click(),
    ]);

    await fileChooser.setFiles({
      name: "poke-memory-backup-2026-01-01.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(MINIMAL_BACKUP)),
    });

    // handleImport calls window.location.reload() on confirmed import.
    // Await navigation to confirm the reload happened.
    await page.waitForURL("/settings");

    // After reload the settings page should still be intact.
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
  });

  test("importing an invalid file shows an error alert", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "file-chooser interception is Chromium-only",
    );

    await openBackupSection(page);

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /^import$/i }).click(),
    ]);

    await fileChooser.setFiles({
      name: "not-a-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ garbage: true })),
    });

    // An error message must appear without a confirmation dialog.
    // Scoped to the error text directly to avoid the Next.js route-announcer
    // <div role="alert"> that is always present in the DOM.
    await expect(
      page.getByText(/isn't a valid poke-memory backup/i),
    ).toBeVisible();
  });
});

test.describe("Backup — export then import round-trip (#766)", () => {
  test("exported backup can be re-imported (round-trip)", async ({
    page,
    browserName,
  }) => {
    // Full round-trip test: export a file, then import it back.
    // Only Chromium supports both download and file-chooser interception.
    test.skip(
      browserName !== "chromium",
      "download + file-chooser interception requires Chromium",
    );

    // Seed a single card so the export is non-trivial.
    await seedSessionIdb(page, {
      cards: [
        {
          id: 1,
          name: "Bulbasaur",
          spriteUrl: "/sprites/pokemon/1.png",
          cardType: "name",
          state: {
            stability: 0,
            difficulty: 0,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
          },
        },
      ],
      limits: {
        name: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        evolution: { maxNewPerDay: 5, maxReviewsPerDay: 50 },
        reverse: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
        cry: { maxNewPerDay: 10, maxReviewsPerDay: 100 },
      },
    });

    await page.goto("/settings");
    await awaitSeedIdb(page);
    await expect(page.getByLabel("Loading settings")).toBeHidden();
    await page.getByRole("button", { name: /account & data/i, exact: true }).click();

    // Step 1: Export — capture the downloaded file contents.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^export$/i }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const exportedJson = Buffer.concat(chunks).toString("utf-8");
    const exportedBackup = JSON.parse(exportedJson) as Record<string, unknown>;

    // The exported file must be a valid backup structure.
    expect(exportedBackup.version).toBe(1);
    expect(typeof exportedBackup.exportedAt).toBe("string");
    expect(Array.isArray(exportedBackup.cards)).toBe(true);

    // Step 2: Import the exported file back.
    page.once("dialog", (dialog) => dialog.accept());

    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /^import$/i }).click(),
    ]);

    await fileChooser.setFiles({
      name: download.suggestedFilename(),
      mimeType: "application/json",
      buffer: Buffer.from(exportedJson),
    });

    // Import accepted: page reloads back to /settings.
    await page.waitForURL("/settings");
    await expect(
      page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible();
  });
});
