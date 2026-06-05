import { renderWithIntl as render, screen } from "@/components/test-utils/renderWithIntl";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";
import { LinkIdentitiesSection } from "@/components/auth/LinkIdentitiesSection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal User fixture with the given linked providers. */
function makeUser(providers: string[]): User {
  return {
    id: "user-123",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2024-01-01T00:00:00.000Z",
    identities: providers.map((provider, i) => ({
      id: `identity-${i}`,
      user_id: "user-123",
      identity_id: `identity-${i}`,
      provider,
      identity_data: {},
      last_sign_in_at: "2024-01-01T00:00:00.000Z",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    })),
  } as unknown as User;
}

/** Build a minimal Supabase client mock. */
function makeMockSupabase(
  linkResult: { error: { message: string } | null } = { error: null },
) {
  return {
    auth: {
      linkIdentity: vi.fn().mockResolvedValue(linkResult),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LinkIdentitiesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("linked providers display", () => {
    it("shows GitHub as connected when user has github identity", () => {
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.getByRole("listitem", { name: /github connected/i }),
      ).toBeInTheDocument();
    });

    it("shows Google as connected when user has google identity", () => {
      const user = makeUser(["google"]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.getByRole("listitem", { name: /google connected/i }),
      ).toBeInTheDocument();
    });

    it("shows both providers connected when user has both identities", () => {
      const user = makeUser(["github", "google"]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.getByRole("listitem", { name: /github connected/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("listitem", { name: /google connected/i }),
      ).toBeInTheDocument();
    });

    it("shows no linked providers list when user has no identities", () => {
      const user = makeUser([]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.queryByRole("list", { name: /connected providers/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("linkable providers display", () => {
    it("offers Connect Google when only github is linked", () => {
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.getByRole("button", { name: /connect google/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /connect github/i }),
      ).not.toBeInTheDocument();
    });

    it("offers Connect GitHub when only google is linked", () => {
      const user = makeUser(["google"]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.getByRole("button", { name: /connect github/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /connect google/i }),
      ).not.toBeInTheDocument();
    });

    it("offers both Connect buttons when no providers are linked", () => {
      const user = makeUser([]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.getByRole("button", { name: /connect github/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /connect google/i }),
      ).toBeInTheDocument();
    });

    it("shows 'all methods connected' copy when all providers are linked", () => {
      const user = makeUser(["github", "google"]);
      const supabase = makeMockSupabase();
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );
      expect(
        screen.getByText(/all available sign-in methods are already connected/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /connect/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("linking flow", () => {
    it("calls linkIdentity with the correct provider and redirectTo from NEXT_PUBLIC_SITE_URL", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase({ error: null });
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pokememory.com");
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => {
        expect(supabase.auth.linkIdentity).toHaveBeenCalledWith({
          provider: "google",
          options: { redirectTo: "https://pokememory.com/api/auth/callback" },
        });
      });

      vi.unstubAllEnvs();
    });

    it("falls back to localhost redirectTo when NEXT_PUBLIC_SITE_URL is unset", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase({ error: null });
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => {
        expect(supabase.auth.linkIdentity).toHaveBeenCalledWith({
          provider: "google",
          options: { redirectTo: "http://localhost:3000/api/auth/callback" },
        });
      });

      vi.unstubAllEnvs();
    });

    it("disables the button while a link is pending", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      // Never resolves during the test - simulates a pending state.
      const supabase = {
        auth: {
          linkIdentity: vi.fn().mockImplementation(() => new Promise(() => {})),
        },
      };
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      // The button should become disabled while the promise is pending.
      expect(
        screen.getByRole("button", { name: /connect google/i }),
      ).toBeDisabled();
    });
  });

  describe("error handling", () => {
    it("shows a generic error message on unexpected failure", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase({
        error: { message: "unexpected server error" },
      });
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => {
        expect(
          screen.getByTestId("link-identities-error"),
        ).toHaveTextContent("Could not connect the provider. Please try again.");
      });
    });

    it("shows 'already connected' message for an already-linked error", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase({
        error: { message: "Identity is already linked to another user" },
      });
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => {
        expect(
          screen.getByTestId("link-identities-error"),
        ).toHaveTextContent("That provider is already connected to your account.");
      });
    });

    it("shows 'email collision' message for an email-conflict error", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase({
        error: {
          message:
            "A user with this email address has already been registered",
        },
      });
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => {
        expect(
          screen.getByTestId("link-identities-error"),
        ).toHaveTextContent(
          "That email address is already linked to a different account. Sign in with that account directly.",
        );
      });
    });

    it("shows error when linkIdentity throws (network failure)", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      const supabase = {
        auth: {
          linkIdentity: vi.fn().mockRejectedValue(new Error("network error")),
        },
      };
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => {
        expect(
          screen.getByTestId("link-identities-error"),
        ).toHaveTextContent("Could not connect the provider. Please try again.");
      });
    });

    it("re-enables the connect button after an error so the user can retry", async () => {
      const ue = userEvent.setup();
      const user = makeUser(["github"]);
      const supabase = makeMockSupabase({
        error: { message: "unexpected server error" },
      });
      render(
        <LinkIdentitiesSection
          user={user}
          supabase={supabase as never}
        />,
      );

      await ue.click(screen.getByRole("button", { name: /connect google/i }));

      await waitFor(() => {
        expect(screen.getByTestId("link-identities-error")).toBeInTheDocument();
      });

      expect(
        screen.getByRole("button", { name: /connect google/i }),
      ).not.toBeDisabled();
    });
  });
});
