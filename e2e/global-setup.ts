import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Pre-populate localStorage with `firstVisitOnboardingDismissed: true` so the
// first-visit onboarding modal (#1103) never renders during a test and blocks
// the Practice / nav surfaces. Specs that explicitly call localStorage.clear()
// or overwrite the settings key must re-seed the flag themselves.
export default function globalSetup(): void {
  const url = new URL(baseURL);
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: `${url.protocol}//${url.host}`,
        localStorage: [
          {
            name: "poke-memory:settings:v1",
            value: JSON.stringify({
              onboarding: { firstVisitOnboardingDismissed: true },
            }),
          },
        ],
      },
    ],
  };
  const outPath = join(__dirname, ".storage-state.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(storageState));
}
