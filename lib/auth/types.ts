export type AuthProvider = "github" | "google";

/**
 * The signed-in user as the app reads it (design D6). Built from the Better
 * Auth session user and their linked accounts (listAccounts), keeping the
 * field names the UI read from the Supabase User, so readers did not change.
 */
export type AppUser = {
  id: string;
  email: string | null;
  created_at: string;
  user_metadata: {
    /** Username accounts: the lower-case username. */
    username?: string;
    name?: string;
    full_name?: string;
    avatar_url?: string;
    /** Not stored by Better Auth (the GitHub login); kept for the mock seam. */
    user_name?: string;
    preferred_username?: string;
  };
  app_metadata: { provider?: string; providers: string[] };
  /** One per linked sign-in method; the password account shows as "email", as in Supabase. */
  identities: { provider: string; id: string }[];
};

/** The Better Auth session user fields toAppUser reads. */
export type SessionUserLike = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  username?: string | null;
  createdAt: Date | string;
};

/** A row from authClient.listAccounts(). */
export type LinkedAccountLike = { providerId: string; accountId: string };

export function toAppUser(user: SessionUserLike, accounts: readonly LinkedAccountLike[]): AppUser {
  const identities = accounts.map((a) => ({
    provider: a.providerId === "credential" ? "email" : a.providerId,
    id: a.accountId,
  }));
  const providers = identities.map((i) => i.provider);
  const name = user.name || undefined;
  return {
    id: user.id,
    email: user.email ?? null,
    created_at: new Date(user.createdAt).toISOString(),
    user_metadata: {
      ...(user.username ? { username: user.username } : {}),
      ...(name ? { name, full_name: name } : {}),
      ...(user.image ? { avatar_url: user.image } : {}),
    },
    app_metadata: { provider: providers[0], providers },
    identities,
  };
}
