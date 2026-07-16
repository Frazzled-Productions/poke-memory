/**
 * Tests for the PushOptIn component (#1056).
 *
 * The component is the visible Web Push opt-in toggle on the Settings page.
 * It has several gating conditions and three interactive paths that the
 * lib/push/subscribe tests do not exercise (those cover the helper layer
 * only). Coverage here drives the diff-coverage gate over the gating /
 * rendering branches.
 *
 * Pattern: lib/push/subscribe and lib/superuser/SuperuserContext are mocked
 * at the module boundary. The DOM-side helpers (isPushSupported / isStandalone)
 * are mocked too because jsdom has neither serviceWorker, PushManager, nor
 * Notification by default. Lives under components/ so the jsdom vitest
 * project picks it up (per AGENTS.md "Testing").
 */

import {
  renderWithIntl as render,
  renderJa,
  renderZhHans,
  renderZhHant,
  screen,
} from "@/components/test-utils/renderWithIntl";
import type { ReactElement } from "react";
import { waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from "@/lib/settings/persistence";
import type { UserSettings } from "@/lib/settings/persistence";

// ---------------------------------------------------------------------------
// Mocks - declared before the component import.
// ---------------------------------------------------------------------------

import type {
  ReconcileResult,
  SubscribeResult,
  UnsubscribeResult,
} from "@/lib/push/subscribe";

const mockIsPushSupported = vi.fn<() => boolean>(() => true);
const mockIsStandalone = vi.fn<() => boolean>(() => true);
const mockHasLocalSubscription = vi.fn<() => Promise<boolean>>(async () => false);
const mockReconcileSubscription = vi.fn<
  (client: SupabaseClient, userId: string) => Promise<ReconcileResult>
>(async () => "in-sync");
const mockSubscribeToPush = vi.fn<
  (client: SupabaseClient, userId: string) => Promise<SubscribeResult>
>(async () => ({ ok: true }));
const mockUnsubscribeFromPush = vi.fn<
  (client: SupabaseClient, userId: string) => Promise<UnsubscribeResult>
>(async () => ({ ok: true }));

vi.mock("@/lib/push/subscribe", () => ({
  isPushSupported: () => mockIsPushSupported(),
  isStandalone: () => mockIsStandalone(),
  hasLocalSubscription: () => mockHasLocalSubscription(),
  reconcileSubscription: (client: SupabaseClient, userId: string) =>
    mockReconcileSubscription(client, userId),
  subscribeToPush: (client: SupabaseClient, userId: string) =>
    mockSubscribeToPush(client, userId),
  unsubscribeFromPush: (client: SupabaseClient, userId: string) =>
    mockUnsubscribeFromPush(client, userId),
}));

const mockUseSuperuser = vi.fn(() => ({ anyFlagOn: false }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => mockUseSuperuser(),
}));

import { PushOptIn } from "@/components/pwa/PushOptIn";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const FAKE_USER = { id: "00000000-0000-0000-0000-000000000001" } as User;
const FAKE_CLIENT = {} as SupabaseClient;

function setNotificationPermission(value: NotificationPermission) {
  // jsdom does not implement Notification; stub the bits the component reads.
  (window as unknown as { Notification: unknown }).Notification = {
    permission: value,
    requestPermission: vi.fn(async () => value),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsPushSupported.mockReturnValue(true);
  mockIsStandalone.mockReturnValue(true);
  mockHasLocalSubscription.mockResolvedValue(false);
  // Default: reconcile confirms the local subscription is in sync.
  mockReconcileSubscription.mockResolvedValue("in-sync");
  mockSubscribeToPush.mockResolvedValue({ ok: true });
  mockUnsubscribeFromPush.mockResolvedValue({ ok: true });
  mockUseSuperuser.mockReturnValue({ anyFlagOn: false });
  setNotificationPermission("default");
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// Gating: renders nothing when any precondition fails.
// ---------------------------------------------------------------------------

describe("PushOptIn - gating", () => {
  it("renders nothing when isStandalone() is false", async () => {
    mockIsStandalone.mockReturnValue(false);
    const { container } = render(
      <PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />,
    );
    // Effect runs on mount; once it resolves the component re-renders with
    // visible=false and returns null. Wait one microtask to be sure.
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders nothing when isPushSupported() is false", async () => {
    mockIsPushSupported.mockReturnValue(false);
    const { container } = render(
      <PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />,
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders the opt-in toggle when both gating conditions pass", async () => {
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    expect(toggle).toBeTruthy();
    // aria-checked reflects the subscribed state - false on a fresh device.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("reflects an existing local subscription as the on state", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// Interaction: subscribe / unsubscribe paths.
// ---------------------------------------------------------------------------

describe("PushOptIn - interaction", () => {
  it("calls subscribeToPush when toggled on from the unsubscribed state", async () => {
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mockSubscribeToPush).toHaveBeenCalledTimes(1);
    expect(mockSubscribeToPush).toHaveBeenCalledWith(FAKE_CLIENT, FAKE_USER.id);
    expect(mockUnsubscribeFromPush).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("calls unsubscribeFromPush when toggled off from the subscribed state", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mockUnsubscribeFromPush).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribeFromPush).toHaveBeenCalledWith(
      FAKE_CLIENT,
      FAKE_USER.id,
    );
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("surfaces the subscribe-failed reason when the helper returns an error", async () => {
    mockSubscribeToPush.mockResolvedValue({
      ok: false,
      reason: "subscribe-failed",
    });
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");

    await act(async () => {
      fireEvent.click(toggle);
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not subscribe/i);
    // State stays unsubscribed because the call did not succeed.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("surfaces the delete-failed reason when unsubscribe returns an error", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    mockUnsubscribeFromPush.mockResolvedValue({
      ok: false,
      reason: "delete-failed",
    });
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });

    await act(async () => {
      fireEvent.click(toggle);
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not unsubscribe/i);
    // State stays subscribed because the call did not succeed.
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Reconciliation (#1858 F35).
// ---------------------------------------------------------------------------

describe("PushOptIn - subscription reconciliation", () => {
  it("shows the toggle ON when hasLocalSubscription=true and reconcile returns 'in-sync'", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    mockReconcileSubscription.mockResolvedValue("in-sync");
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("shows the toggle ON when reconcile returns 're-inserted' (row was missing but re-persisted)", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    mockReconcileSubscription.mockResolvedValue("re-inserted");
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("shows the toggle OFF when reconcile returns 'disabled' (orphaned subscription, re-insert failed)", async () => {
    // The local PushManager has a subscription but there is no server row and
    // re-insert failed (orphaned endpoint). PushOptIn should flip the toggle
    // off so the user sees that reminders have stopped (#1858 F35).
    mockHasLocalSubscription.mockResolvedValue(true);
    mockReconcileSubscription.mockResolvedValue("disabled");
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });
  });
});

// ---------------------------------------------------------------------------
// Superuser write-guard.
// ---------------------------------------------------------------------------

describe("PushOptIn - superuser guard", () => {
  it("renders the disabled 'Sync paused' label when any flag is on", async () => {
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const button = await screen.findByTestId("push-optin-button");
    expect(button.textContent).toMatch(/sync paused/i);
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("does not invoke subscribeToPush even if the disabled button is clicked", async () => {
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const button = await screen.findByTestId("push-optin-button");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockSubscribeToPush).not.toHaveBeenCalled();
    expect(mockUnsubscribeFromPush).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Localised aria-label (#1607).
// ---------------------------------------------------------------------------

describe("PushOptIn - localised aria-label", () => {
  it("toggle aria-label is localised in Japanese", async () => {
    renderJa(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    expect(toggle.getAttribute("aria-label")).toBe("毎日のレビューリマインダー");
  });
});

// ---------------------------------------------------------------------------
// Permission-denied explainer branch.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Streak reminder toggle (#1950) - nested under the primary toggle.
// ---------------------------------------------------------------------------

describe("PushOptIn - streak reminder toggle", () => {
  function settingsWith(overrides: Partial<UserSettings>): UserSettings {
    return { ...DEFAULT_SETTINGS, ...overrides };
  }

  it("defaults OFF and is DISABLED (aria-disabled) while the primary toggle is off", async () => {
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const primary = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(primary.getAttribute("aria-checked")).toBe("false");
    });

    const streakToggle = await screen.findByTestId("push-streak-optin-button");
    expect(streakToggle.getAttribute("aria-checked")).toBe("false");
    expect(streakToggle.getAttribute("aria-disabled")).toBe("true");
    expect(streakToggle.hasAttribute("disabled")).toBe(true);
    // The dependency hint is shown while the primary toggle is off.
    expect(
      screen.getByText(/turn on daily review reminder first/i),
    ).toBeTruthy();
  });

  it("becomes enabled once the primary toggle is subscribed", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const primary = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(primary.getAttribute("aria-checked")).toBe("true");
    });

    const streakToggle = await screen.findByTestId("push-streak-optin-button");
    await waitFor(() => {
      expect(streakToggle.hasAttribute("disabled")).toBe(false);
    });
    expect(streakToggle.getAttribute("aria-disabled")).toBe("false");
    expect(
      screen.queryByText(/turn on daily review reminder first/i),
    ).toBeNull();
  });

  it("reflects a previously-persisted streakNudgeEnabled=true on load", async () => {
    saveSettings(settingsWith({ streakNudgeEnabled: true }));
    mockHasLocalSubscription.mockResolvedValue(true);
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const streakToggle = await screen.findByTestId("push-streak-optin-button");
    await waitFor(() => {
      expect(streakToggle.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("toggling persists streakNudgeEnabled via saveSettings", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const streakToggle = await screen.findByTestId("push-streak-optin-button");
    await waitFor(() => {
      expect(streakToggle.hasAttribute("disabled")).toBe(false);
    });

    await act(async () => {
      fireEvent.click(streakToggle);
    });

    await waitFor(() => {
      expect(streakToggle.getAttribute("aria-checked")).toBe("true");
    });
    expect(loadSettings().streakNudgeEnabled).toBe(true);

    await act(async () => {
      fireEvent.click(streakToggle);
    });
    await waitFor(() => {
      expect(streakToggle.getAttribute("aria-checked")).toBe("false");
    });
    expect(loadSettings().streakNudgeEnabled).toBe(false);
  });

  it("clicking while disabled does not toggle or persist", async () => {
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const streakToggle = await screen.findByTestId("push-streak-optin-button");
    await waitFor(() => {
      expect(streakToggle.hasAttribute("disabled")).toBe(true);
    });

    await act(async () => {
      fireEvent.click(streakToggle);
    });

    expect(streakToggle.getAttribute("aria-checked")).toBe("false");
    expect(loadSettings().streakNudgeEnabled).toBe(false);
  });

  it("is disabled when a superuser flag is on, even with a subscribed primary toggle", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const streakToggle = await screen.findByTestId("push-streak-optin-button");
    expect(streakToggle.hasAttribute("disabled")).toBe(true);
  });

  it("shows the superuser-paused reason (not the primary-off hint) when a flag is on, even if subscribed", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    mockUseSuperuser.mockReturnValue({ anyFlagOn: true });
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    await screen.findByTestId("push-streak-optin-button");
    expect(
      screen.getByText(/notifications are paused while a superuser flag is on/i),
    ).toBeTruthy();
    expect(
      screen.queryByText(/turn on daily review reminder first/i),
    ).toBeNull();
  });

  it("resets streakNudgeEnabled to false when the primary toggle is turned off", async () => {
    mockHasLocalSubscription.mockResolvedValue(true);
    saveSettings(settingsWith({ streakNudgeEnabled: true }));
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const primary = await screen.findByTestId("push-optin-button");
    await waitFor(() => {
      expect(primary.getAttribute("aria-checked")).toBe("true");
    });
    const streakToggle = await screen.findByTestId("push-streak-optin-button");
    await waitFor(() => {
      expect(streakToggle.getAttribute("aria-checked")).toBe("true");
    });

    await act(async () => {
      fireEvent.click(primary);
    });

    await waitFor(() => {
      expect(primary.getAttribute("aria-checked")).toBe("false");
    });
    await waitFor(() => {
      expect(streakToggle.getAttribute("aria-checked")).toBe("false");
    });
    expect(loadSettings().streakNudgeEnabled).toBe(false);
  });

  it("renders the label and helper text in en, ja, zh-Hans, and zh-Hant", async () => {
    const cases: Array<{
      renderFn: (ui: ReactElement) => unknown;
      label: string;
      description: string;
    }> = [
      {
        renderFn: render,
        label: "Streak reminder",
        description:
          "A gentle nudge later in the day if you haven't practised yet, to help keep your streak going.",
      },
      {
        renderFn: renderJa,
        label: "ストリークリマインダー",
        description:
          "まだ練習していない場合、その日の後半にもう一度やさしく通知して、ストリークを続けられるようお手伝いします。",
      },
      {
        renderFn: renderZhHans,
        label: "连胜提醒",
        description:
          "如果你当天还没有练习，我们会在当天稍晚再温柔地提醒你一次，帮助你继续保持连胜。",
      },
      {
        renderFn: renderZhHant,
        label: "連勝提醒",
        description:
          "如果你當天還沒有練習，我們會在當天稍晚再溫柔地提醒你一次，幫助你繼續保持連勝。",
      },
    ];

    for (const { renderFn, label, description } of cases) {
      renderFn(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
      const toggle = await screen.findByTestId("push-streak-optin-button");
      expect(toggle.getAttribute("aria-label")).toBe(label);
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(description)).toBeTruthy();
      cleanup();
    }
  });
});

describe("PushOptIn - permission denied", () => {
  it("shows the iOS Settings explainer when Notification.permission is 'denied'", async () => {
    setNotificationPermission("denied");
    render(<PushOptIn user={FAKE_USER} supabase={FAKE_CLIENT} />);
    const toggle = await screen.findByTestId("push-optin-button");
    // Explainer text should be present.
    await waitFor(() => {
      expect(
        screen.getByText(/notifications are blocked for this app/i),
      ).toBeTruthy();
    });
    // Toggle is disabled in this state.
    expect(toggle.hasAttribute("disabled")).toBe(true);
  });
});
