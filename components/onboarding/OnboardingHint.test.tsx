import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import {
  DEFAULT_SETTINGS,
  SETTINGS_SAVED_EVENT,
} from "@/lib/settings/persistence";
import type { UserSettings } from "@/lib/settings/persistence";

// In-memory settings stub. The component reads via loadSettings() and writes
// via saveSettings(), both mocked here so we can drive the dismissal state
// without depending on jsdom's gated localStorage.
let currentSettings: UserSettings;

vi.mock("@/lib/settings/persistence", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/settings/persistence")
  >("@/lib/settings/persistence");
  return {
    ...actual,
    loadSettings: () => currentSettings,
    saveSettings: (next: UserSettings) => {
      currentSettings = next;
      window.dispatchEvent(
        new CustomEvent(actual.SETTINGS_SAVED_EVENT, { detail: next }),
      );
    },
  };
});

beforeEach(() => {
  currentSettings = { ...DEFAULT_SETTINGS };
});

describe("OnboardingHint", () => {
  it("renders its children when the flag is not dismissed", async () => {
    render(<OnboardingHint id="welcomeDismissed">Hello there.</OnboardingHint>);
    expect(await screen.findByText(/Hello there\./)).toBeTruthy();
  });

  it("renders nothing when the flag is already dismissed", () => {
    currentSettings = {
      ...DEFAULT_SETTINGS,
      onboarding: { ...DEFAULT_SETTINGS.onboarding, welcomeDismissed: true },
    };
    const { container } = render(
      <OnboardingHint id="welcomeDismissed">Hello there.</OnboardingHint>,
    );
    expect(container.textContent).toBe("");
  });

  it("dismiss button persists the flag and hides the hint", async () => {
    render(<OnboardingHint id="practiceHintDismissed">Tip.</OnboardingHint>);
    const dismiss = await screen.findByRole("button", { name: /dismiss hint/i });
    await userEvent.click(dismiss);

    expect(currentSettings.onboarding.practiceHintDismissed).toBe(true);
    expect(screen.queryByText("Tip.")).toBeNull();
  });

  it("renders the CTA link when ctaHref + ctaLabel are provided", async () => {
    render(
      <OnboardingHint
        id="welcomeDismissed"
        tone="callout"
        ctaHref="/settings"
        ctaLabel="Learn more"
      >
        Body.
      </OnboardingHint>,
    );
    const link = await screen.findByRole("link", { name: /learn more/i });
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("re-renders when SETTINGS_SAVED_EVENT fires (e.g. after reset)", async () => {
    currentSettings = {
      ...DEFAULT_SETTINGS,
      onboarding: { ...DEFAULT_SETTINGS.onboarding, statsHintDismissed: true },
    };
    render(<OnboardingHint id="statsHintDismissed">Body.</OnboardingHint>);
    expect(screen.queryByText("Body.")).toBeNull();

    act(() => {
      currentSettings = {
        ...DEFAULT_SETTINGS,
        onboarding: {
          ...DEFAULT_SETTINGS.onboarding,
          statsHintDismissed: false,
        },
      };
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
    });

    expect(await screen.findByText("Body.")).toBeTruthy();
  });

  it("treats an absent onboarding field as not dismissed (defensive)", async () => {
    // Older stored payloads written before #433 omit the onboarding field.
    // The component must not crash and must show the hint.
    const partial = { ...DEFAULT_SETTINGS } as Partial<UserSettings>;
    delete (partial as { onboarding?: unknown }).onboarding;
    currentSettings = partial as UserSettings;

    render(<OnboardingHint id="welcomeDismissed">Hello.</OnboardingHint>);
    expect(await screen.findByText("Hello.")).toBeTruthy();
  });
});
