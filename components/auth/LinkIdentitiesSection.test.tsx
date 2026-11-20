import { renderWithIntl as render, screen } from "@/components/test-utils/renderWithIntl";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AppUser } from "@/lib/auth/types";

const mockLinkSocial = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/client", () => ({
  authClient: { linkSocial: (...args: unknown[]) => mockLinkSocial(...args) },
}));

import { LinkIdentitiesSection } from "@/components/auth/LinkIdentitiesSection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal AppUser with the given linked providers (as listAccounts maps them). */
function makeUser(providers: string[]): AppUser {
  return {
    id: "user-123",
    email: null,
    created_at: "2024-01-01T00:00:00.000Z",
    user_metadata: {},
    app_metadata: { provider: providers[0], providers },
    identities: providers.map((provider, i) => ({ provider, id: `account-${i}` })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LinkIdentitiesSection", () => {
  beforeEach(() => {
    mockLinkSocial.mockReset();
  });

  describe("linked providers display", () => {
    it("shows GitHub as connected when user has github identity", () => {
      render(<LinkIdentitiesSection user={makeUser(["github"])} />);
      expect(screen.getByRole("listitem", { name: /github connected/i })).toBeInTheDocument();
    });

    it("shows Google as connected when user has google identity", () => {
      render(<LinkIdentitiesSection user={makeUser(["google"])} />);
      expect(screen.getByRole("listitem", { name: /google connected/i })).toBeInTheDocument();
    });

    it("shows both providers connected when user has both identities", () => {
      render(<LinkIdentitiesSection user={makeUser(["github", "google"])} />);
      expect(screen.getByRole("listitem", { name: /github connected/i })).toBeInTheDocument();
      expect(screen.getByRole("listitem", { name: /google connected/i })).toBeInTheDocument();
    });

    it("shows no linked providers list for a username-only account", () => {
      render(<LinkIdentitiesSection user={makeUser(["email"])} />);
      expect(screen.queryByRole("list")).toBeNull();
    });
  });

  describe("linkable providers", () => {
    it("offers Connect Google when only github is linked", () => {
      render(<LinkIdentitiesSection user={makeUser(["github"])} />);
      expect(screen.getByRole("button", { name: /connect google/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /connect github/i })).toBeNull();
    });

    it("offers both Connect buttons when no providers are linked", () => {
      render(<LinkIdentitiesSection user={makeUser([])} />);
      expect(screen.getByRole("button", { name: /connect github/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect google/i })).toBeInTheDocument();
    });

    it("shows 'all methods connected' copy when all providers are linked", () => {
      render(<LinkIdentitiesSection user={makeUser(["github", "google"])} />);
      expect(screen.getByText(/all available sign-in methods are already connected/i)).toBeInTheDocument();
    });
  });

  describe("linking", () => {
    it("calls linkSocial with the provider, back to settings, failures to the home banner", async () => {
      const ue = userEvent.setup();
      mockLinkSocial.mockResolvedValue({ data: { url: "https://accounts.google.com/" }, error: null });
      render(<LinkIdentitiesSection user={makeUser(["github"])} />);

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      expect(mockLinkSocial).toHaveBeenCalledWith({
        provider: "google",
        callbackURL: "/settings",
        errorCallbackURL: "/",
      });
    });

    it("disables the button while a link is pending", async () => {
      const ue = userEvent.setup();
      mockLinkSocial.mockImplementation(() => new Promise(() => {}));
      render(<LinkIdentitiesSection user={makeUser(["github"])} />);

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      expect(screen.getByRole("button", { name: /connect google/i })).toBeDisabled();
    });
  });

  describe("error handling", () => {
    it("shows 'already connected' for SOCIAL_ACCOUNT_ALREADY_LINKED", async () => {
      const ue = userEvent.setup();
      mockLinkSocial.mockResolvedValue({ data: null, error: { status: 400, code: "SOCIAL_ACCOUNT_ALREADY_LINKED" } });
      render(<LinkIdentitiesSection user={makeUser(["github"])} />);

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() =>
        expect(screen.getByTestId("link-identities-error")).toHaveTextContent(/already connected to your account/i),
      );
    });

    it("shows a generic error message on any other failure", async () => {
      const ue = userEvent.setup();
      mockLinkSocial.mockResolvedValue({ data: null, error: { status: 500, code: "INTERNAL_SERVER_ERROR" } });
      render(<LinkIdentitiesSection user={makeUser(["github"])} />);

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() =>
        expect(screen.getByTestId("link-identities-error")).toHaveTextContent(/could not connect the provider/i),
      );
    });

    it("shows an error and re-enables the button when linkSocial throws", async () => {
      const ue = userEvent.setup();
      mockLinkSocial.mockRejectedValue(new Error("network"));
      render(<LinkIdentitiesSection user={makeUser(["github"])} />);

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => expect(screen.getByTestId("link-identities-error")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: /connect google/i })).not.toBeDisabled();
    });
  });
});
