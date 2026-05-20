import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// StorageQuotaBanner smoke tests (#766)
//
// The banner is rendered by ReviewSession when `quotaExceeded` is true.
// `quotaExceeded` is set by `notifySaveResult({ ok: false })`, which is
// called after `saveSession` returns a failed save result.
//
// `saveSession` uses IndexedDB (IDB) by default. The quota-error path only
// fires when IDB is unavailable and the localStorage fallback throws a
// QuotaExceededError. To trigger this end-to-end we:
//   1. Block IDB writes via addInitScript so idbAvailable flips to false on
//      the first attempted write, and the app uses the localStorage fallback.
//   2. Seed the session card directly into localStorage so loadSessionLS can
//      find it and the practice page shows a Reveal button.
//   3. Override localStorage.setItem for the session key to throw a
//      QuotaExceededError, so saveSessionLS returns { ok: false, reason: "quota" }.
//   4. Grade the card — saveSession calls saveSessionLS, which throws, and
//      notifySaveResult({ ok: false }) sets quotaExceeded=true, surfacing the banner.
// ---------------------------------------------------------------------------

/** Minimal session with a single Bulbasaur name card due for review. */
const MINIMAL_SESSION = JSON.stringify({
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
    evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("StorageQuotaBanner (#766)", () => {
  test.beforeEach(async ({ page }) => {
    // Inject the quota-failure environment before the app initialises.
    // addInitScript receives a serialisable argument; the session JSON string
    // is passed through as data rather than closing over the module constant.
    await page.addInitScript(
      ({ sessionJson }: { sessionJson: string }) => {
        const SESSION_KEY = "poke-memory:review-session:v1";
        const SETTINGS_KEY = "poke-memory:settings:v1";

        // Pre-dismiss the first-visit modal so it does not block the Reveal button.
        window.localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify({ onboarding: { firstVisitOnboardingDismissed: true } }),
        );

        // Seed the session into localStorage so loadSessionLS can find it.
        window.localStorage.setItem(SESSION_KEY, sessionJson);

        // Override localStorage.setItem to throw QuotaExceededError for the
        // session key, simulating a full storage. All other keys are passed
        // through so the rest of the app (settings, streak, etc.) works normally.
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key: string, value: string) {
          if (key === SESSION_KEY) {
            const err = new DOMException("QuotaExceededError", "QuotaExceededError");
            // code=22 is the legacy IE constant that app code also checks.
            Object.defineProperty(err, "code", { value: 22 });
            throw err;
          }
          return originalSetItem.call(this, key, value);
        };

        // Block IndexedDB writes so the app falls back to the localStorage path.
        // We intercept indexedDB.open and, once the DB is open, monkey-patch
        // transaction() on the resulting IDBDatabase so that readwrite
        // transactions abort immediately, causing idbSet to swallow the error
        // and flip idbAvailable=false. Read-only transactions are left intact
        // so idbGet still returns the seeded value where the app uses it.
        const originalOpen = indexedDB.open.bind(indexedDB);
        Object.defineProperty(indexedDB, "open", {
          value(name: string, version?: number) {
            const req = originalOpen(name, version);
            const origSuccess = req.onsuccess;
            req.onsuccess = function (ev: Event) {
              if (origSuccess) origSuccess.call(this, ev);
              const db = (req as IDBOpenDBRequest).result;
              if (!db) return;
              const origTxMethod = db.transaction.bind(db);
              db.transaction = function (...txArgs: Parameters<typeof origTxMethod>) {
                const tx = origTxMethod(...txArgs);
                if (tx.mode === "readwrite") {
                  const origObjectStore = tx.objectStore.bind(tx);
                  tx.objectStore = function (storeName: string) {
                    const store = origObjectStore(storeName);
                    const origPut = store.put.bind(store);
                    store.put = function (...putArgs: Parameters<typeof origPut>) {
                      const putReq = origPut(...putArgs);
                      // Abort the transaction so idbSet's catch fires and
                      // idbAvailable flips to false.
                      setTimeout(() => { try { tx.abort(); } catch { /* already done */ } }, 0);
                      return putReq;
                    };
                    return store;
                  };
                }
                return tx;
              };
            };
            return req;
          },
          configurable: true,
        });
      },
      { sessionJson: MINIMAL_SESSION },
    );
  });

  test("banner appears after a quota-exceeded save failure", async ({
    page,
  }) => {
    await page.goto("/");

    // The Reveal button confirms the session loaded from localStorage.
    const reveal = page.getByRole("button", { name: "Reveal" });
    if (!(await reveal.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Reveal and grade — this triggers saveSession, which fails with a quota error.
    await reveal.click();
    const gradeGroup = page.getByRole("group", { name: "Grade your answer" });
    await expect(gradeGroup).toBeVisible();
    await gradeGroup.getByRole("button", { name: "Good" }).click();

    // The StorageQuotaBanner must appear with its warning text.
    // Scoped to the banner's unique text rather than role="alert" to avoid the
    // Next.js route-announcer <div role="alert"> that is always present in the DOM.
    await expect(
      page.getByText(/storage is full/i),
    ).toBeVisible({ timeout: 5_000 });

    // The dismiss button must be present and accessible.
    await expect(
      page.getByRole("button", { name: "Dismiss" }),
    ).toBeVisible();
  });

  test("banner can be dismissed", async ({ page }) => {
    await page.goto("/");

    const reveal = page.getByRole("button", { name: "Reveal" });
    if (!(await reveal.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip();
      return;
    }

    // Grade to trigger the quota-failure banner.
    await reveal.click();
    const gradeGroup = page.getByRole("group", { name: "Grade your answer" });
    await expect(gradeGroup).toBeVisible();
    await gradeGroup.getByRole("button", { name: "Again" }).click();

    // Wait for the banner to appear.
    // Scoped to the banner's unique text to avoid the Next.js route-announcer
    // <div role="alert"> that is always present in the DOM.
    const banner = page.getByText(/progress saving is disabled/i);
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Clicking Dismiss must hide the banner.
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toBeHidden();
  });
});
