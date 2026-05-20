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

import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Mocks — declared before the component import.
// ---------------------------------------------------------------------------

import type {
  SubscribeResult,
  UnsubscribeResult,
} from "@/lib/push/subscribe";

const mockIsPushSupported = vi.fn<() => boolean>(() => true);
const mockIsStandalone = vi.fn<() => boolean>(() => true);
const mockHasLocalSubscription = vi.fn<() => Promise<boolean>>(async () => false);
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
  mockSubscribeToPush.mockResolvedValue({ ok: true });
  mockUnsubscribeFromPush.mockResolvedValue({ ok: true });
  mockUseSuperuser.mockReturnValue({ anyFlagOn: false });
  setNotificationPermission("default");
});

// ---------------------------------------------------------------------------
// Gating: renders nothing when any precondition fails.
// ---------------------------------------------------------------------------

describe("PushOptIn — gating", () => {
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
    // aria-checked reflects the subscribed state — false on a fresh device.
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

describe("PushOptIn — interaction", () => {
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
// Superuser write-guard.
// ---------------------------------------------------------------------------

describe("PushOptIn — superuser guard", () => {
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
// Permission-denied explainer branch.
// ---------------------------------------------------------------------------

describe("PushOptIn — permission denied", () => {
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
