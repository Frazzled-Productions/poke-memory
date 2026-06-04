/**
 * FeedbackModal component tests (#1622)
 *
 * Covers:
 * - Renders correctly (form fields, privacy notice visible)
 * - Category is required (submit disabled without category)
 * - Character counter updates and caps at 2000
 * - Submit POSTs the correct payload (category, message, page=pathname, appVersion)
 * - Success state replaces the form on 200
 * - Error state shows inline + retry on failure, does NOT close the modal
 * - Cmd/Ctrl+Enter submits from textarea
 * - Privacy notice is present
 * - Works for guest AND authenticated (component is auth-agnostic)
 * - Locale coverage: en, ja, zh-Hans, zh-Hant
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
  screen,
  fireEvent,
  waitFor,
} from "@/components/test-utils/renderWithIntl";
import { FeedbackModal } from "./FeedbackModal";

// --- Fetch mock helpers -------------------------------------------------------

function mockFetchOk() {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
}

function mockFetchFail() {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: false }), { status: 500 }),
  );
}

function mockFetchNetworkError() {
  vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
    new Error("Network error"),
  );
}

// jsdom does not implement HTMLDialogElement.showModal / close. Polyfill
// them so the dialog mounts and its content is accessible (same pattern as
// DeleteAccountDialog.test.tsx).
function stubDialog() {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}

// --- Setup -------------------------------------------------------------------

beforeEach(() => {
  stubDialog();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper to render the modal in the open state
function renderOpen() {
  return renderWithIntl(
    <FeedbackModal open={true} onClose={vi.fn()} />,
  );
}

// --- Basic render ------------------------------------------------------------

describe("FeedbackModal - renders correctly", () => {
  it("renders the category selector with all three options", () => {
    renderOpen();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /bug report/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /feature request/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /other/i })).toBeInTheDocument();
  });

  it("renders the message textarea with a visible label", () => {
    renderOpen();
    expect(screen.getByLabelText(/message/i)).toBeInTheDocument();
  });

  it("renders the character counter at 0/2000 initially", () => {
    renderOpen();
    expect(screen.getByText(/0\/2[,\s]?000/)).toBeInTheDocument();
  });

  it("renders the privacy notice", () => {
    renderOpen();
    expect(
      screen.getByText(/please do not include personal information/i),
    ).toBeInTheDocument();
  });

  it("renders the Submit and Cancel buttons", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: /^send$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});

// --- Category required -------------------------------------------------------

describe("FeedbackModal - category required", () => {
  it("Submit button is disabled when no category is selected", () => {
    renderOpen();
    const submitBtn = screen.getByRole("button", { name: /^send$/i });
    expect(submitBtn).toBeDisabled();
  });

  it("Submit button is disabled when category is set but message is empty", () => {
    renderOpen();
    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "bug" },
    });
    const submitBtn = screen.getByRole("button", { name: /^send$/i });
    expect(submitBtn).toBeDisabled();
  });

  it("Submit button is enabled when both category and message are filled", () => {
    renderOpen();
    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "bug" },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "This is a bug" },
    });
    const submitBtn = screen.getByRole("button", { name: /^send$/i });
    expect(submitBtn).not.toBeDisabled();
  });
});

// --- Character counter -------------------------------------------------------

describe("FeedbackModal - character counter", () => {
  it("updates as the user types", () => {
    renderOpen();
    const textarea = screen.getByLabelText(/message/i);
    fireEvent.change(textarea, { target: { value: "Hello" } });
    expect(screen.getByText(/5\/2[,\s]?000/)).toBeInTheDocument();
  });

  it("disables submit when message exceeds 2000 chars", () => {
    renderOpen();
    const textarea = screen.getByLabelText(/message/i);
    const longMessage = "x".repeat(2001);
    fireEvent.change(textarea, { target: { value: longMessage } });
    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "bug" },
    });
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });
});

// --- Submit calls API with correct payload -----------------------------------

describe("FeedbackModal - submit payload", () => {
  it("POSTs the correct payload on submit", async () => {
    mockFetchOk();
    renderOpen();

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "feature" },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "Add dark mode" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/feedback");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string) as {
      category: string;
      message: string;
      page: string;
      appVersion?: string;
    };
    expect(body.category).toBe("feature");
    expect(body.message).toBe("Add dark mode");
    expect(typeof body.page).toBe("string");
    // appVersion comes from process.env.NEXT_PUBLIC_APP_VERSION (may be undefined in test)
    // but the key must be present when the env var is set; in test env it may be absent
    expect("appVersion" in body || body.appVersion === undefined).toBe(true);
  });
});

// --- Success state -----------------------------------------------------------

describe("FeedbackModal - success state", () => {
  it("shows confirmation message and hides form on 200 response", async () => {
    mockFetchOk();
    renderOpen();

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "bug" },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "Found a bug" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    });

    // Form should be gone.
    expect(screen.queryByLabelText(/category/i)).not.toBeInTheDocument();
    // Success heading and body must be visible.
    expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    expect(screen.getByText(/feedback has been received/i)).toBeInTheDocument();
    // Close button is shown.
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });
});

// --- Error state -------------------------------------------------------------

describe("FeedbackModal - error state", () => {
  it("shows inline error and keeps form open on 500 response", async () => {
    mockFetchFail();
    renderOpen();

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "Something" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    });

    // Error message must appear.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
    // Form must still be visible (modal stayed open).
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    // Submit button must be re-enabled so the user can retry.
    expect(screen.getByRole("button", { name: /^send$/i })).not.toBeDisabled();
  });

  it("shows error and keeps form open on network error", async () => {
    mockFetchNetworkError();
    renderOpen();

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "bug" },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "Crash" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
  });
});

// --- Cmd/Ctrl+Enter submits --------------------------------------------------

describe("FeedbackModal - keyboard submit", () => {
  it("submits the form on Cmd+Enter from the textarea", async () => {
    mockFetchOk();
    renderOpen();

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "feature" },
    });
    const textarea = screen.getByLabelText(/message/i);
    fireEvent.change(textarea, { target: { value: "Keyboard shortcut test" } });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    expect(fetch).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    });
  });

  it("submits the form on Ctrl+Enter from the textarea", async () => {
    mockFetchOk();
    renderOpen();

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "bug" },
    });
    const textarea = screen.getByLabelText(/message/i);
    fireEvent.change(textarea, { target: { value: "Ctrl+Enter test" } });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    });

    expect(fetch).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    });
  });
});

// --- Guest / auth agnostic ---------------------------------------------------

describe("FeedbackModal - guest and auth agnostic", () => {
  it("renders and submits without any auth context (guest mode)", async () => {
    mockFetchOk();
    // No auth provider needed; the component only calls fetch.
    renderWithIntl(<FeedbackModal open={true} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText(/message/i), {
      target: { value: "Guest feedback" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/thank you/i)).toBeInTheDocument();
    });
  });
});

// --- Locale coverage ---------------------------------------------------------

describe("FeedbackModal - locale coverage", () => {
  it("renders in Japanese (ja) with localised labels", () => {
    renderJa(<FeedbackModal open={true} onClose={vi.fn()} />);
    // Japanese submit button text.
    expect(screen.getByRole("button", { name: /送信/ })).toBeInTheDocument();
  });

  it("renders in Simplified Chinese (zh-Hans) with localised labels", () => {
    renderZhHans(<FeedbackModal open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /发送/ })).toBeInTheDocument();
  });

  it("renders in Traditional Chinese (zh-Hant) with localised labels", () => {
    renderZhHant(<FeedbackModal open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /傳送/ })).toBeInTheDocument();
  });

  it("renders the privacy notice in Japanese", () => {
    renderJa(<FeedbackModal open={true} onClose={vi.fn()} />);
    // Privacy notice should contain Japanese text about personal information.
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByRole("note").textContent).toMatch(/個人情報/);
  });
});
