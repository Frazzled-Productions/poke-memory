"use client";

/**
 * Allows a signed-in user to link a second OAuth provider to their account.
 *
 * Uses supabase.auth.linkIdentity() which is currently in beta.
 * The no-beta-auth rule has been knowingly overridden by the repo owner for
 * this feature — see PR #362.
 *
 * Placed in components/auth/ to sit alongside AuthButton, the other
 * auth-surface component.
 */

import { useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthProvider } from "@/lib/auth/types";
import { cn } from "@/lib/utils/cn";
import { cardPanelPadded, colStack, mutedText, mutedTextXs, sectionLabel } from "@/lib/utils/class-names";

/** Human-readable display names for each provider. */
const PROVIDER_LABELS: Record<AuthProvider, string> = {
  github: "GitHub",
  google: "Google",
};

/** All providers supported by the app. */
const ALL_PROVIDERS: AuthProvider[] = ["github", "google"];

type LinkState = "idle" | "pending" | "success" | "error";

type Props = {
  user: User;
  supabase: SupabaseClient;
};

/**
 * Returns the set of OAuth providers already linked to this user.
 * `user.identities` is undefined when the user has no linked identities —
 * treat that as an empty list.
 */
function linkedProviders(user: User): Set<AuthProvider> {
  const identities = user.identities ?? [];
  const providers = new Set<AuthProvider>();
  for (const identity of identities) {
    const p = identity.provider as string;
    if (p === "github" || p === "google") {
      providers.add(p as AuthProvider);
    }
  }
  return providers;
}

/**
 * Maps a Supabase linkIdentity error message to a friendly user-facing string.
 */
function friendlyError(rawMessage: string): string {
  const msg = rawMessage.toLowerCase();

  // Already linked to this user.
  if (
    msg.includes("identity is already linked") ||
    msg.includes("already linked") ||
    msg.includes("provider already linked")
  ) {
    return "That provider is already connected to your account.";
  }

  // The email on the OAuth account is already in use by a different Supabase user.
  // Supabase returns "a user with this email address has already been registered"
  // for the identity-already-linked-to-another-user case. We match the full
  // phrase to avoid misclassifying unrelated errors that happen to mention "registered".
  if (msg.includes("a user with this email address has already been registered")) {
    return "That email address is already linked to a different account. Sign in with that account directly.";
  }

  return "Could not connect the provider. Please try again.";
}

/**
 * One button row for a single linkable provider.
 */
function LinkProviderRow({
  provider,
  onLink,
  disabled,
}: {
  provider: AuthProvider;
  onLink: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onLink}
      disabled={disabled}
      className="min-h-[44px] w-full rounded-lg border border-zinc-300 bg-background px-4 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      aria-label={`Connect ${PROVIDER_LABELS[provider]}`}
    >
      Connect {PROVIDER_LABELS[provider]}
    </button>
  );
}

/**
 * Settings section that shows linked OAuth identities and lets the user
 * link an additional provider.
 *
 * Only rendered when the user is signed in (the caller gates on this).
 */
export function LinkIdentitiesSection({ user, supabase }: Props) {
  const [linkState, setLinkState] = useState<LinkState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingProvider, setPendingProvider] = useState<AuthProvider | null>(null);

  const linked = linkedProviders(user);
  const linkable = ALL_PROVIDERS.filter((p) => !linked.has(p));

  async function handleLink(provider: AuthProvider) {
    setLinkState("pending");
    setPendingProvider(provider);
    setErrorMsg(null);

    try {
      const base =
        process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: `${base}/api/auth/callback` },
      });

      if (error) {
        setLinkState("error");
        setErrorMsg(friendlyError(error.message));
        setPendingProvider(null);
        return;
      }

      // linkIdentity redirects the browser to the OAuth provider. If we reach
      // here the redirect did not happen (unexpected), so surface a generic
      // success note. In normal usage the page will navigate away before
      // React re-renders.
      setLinkState("success");
      setPendingProvider(null);
    } catch (err) {
      setLinkState("error");
      setErrorMsg(
        err instanceof Error
          ? friendlyError(err.message)
          : "Could not connect the provider. Please try again.",
      );
      setPendingProvider(null);
    }
  }

  return (
    <div
      id="linked-accounts-heading"
      className={cardPanelPadded}
    >
      <p className={sectionLabel}>
        Sign-in methods
      </p>

      {/* Currently linked providers */}
      {linked.size > 0 && (
        <ul
          aria-label="Connected providers"
          className="mt-3 flex flex-wrap gap-2"
        >
          {Array.from(linked).map((p) => (
            <li
              key={p}
              className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              aria-label={`${PROVIDER_LABELS[p]} connected`}
            >
              {PROVIDER_LABELS[p]} connected
            </li>
          ))}
        </ul>
      )}

      {/* Linkable providers */}
      {linkable.length > 0 ? (
        <div className={cn("mt-3", colStack)} aria-live="polite">
          <p className="text-sm text-foreground">
            Connect another sign-in method to access your account from multiple providers.
          </p>
          <div className={cn("mt-1", colStack)}>
            {linkable.map((provider) => (
              <LinkProviderRow
                key={provider}
                provider={provider}
                onLink={() => void handleLink(provider)}
                disabled={linkState === "pending"}
              />
            ))}
          </div>
          {linkState === "pending" && pendingProvider && (
            <p
              role="status"
              className={mutedTextXs}
            >
              Connecting {PROVIDER_LABELS[pendingProvider]}... you will be redirected.
            </p>
          )}
          {linkState === "error" && errorMsg !== null && (
            <p
              role="alert"
              data-testid="link-identities-error"
              className="text-xs font-medium text-red-600 dark:text-red-400"
            >
              {errorMsg}
            </p>
          )}
          {linkState === "success" && (
            <p
              role="status"
              className="text-xs font-medium text-emerald-600 dark:text-emerald-400"
            >
              Provider connected successfully.
            </p>
          )}
        </div>
      ) : (
        <p className={cn("mt-3", mutedText)}>
          All available sign-in methods are already connected.
        </p>
      )}
    </div>
  );
}
