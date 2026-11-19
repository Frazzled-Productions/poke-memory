"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createDataClient, type DataClient } from "@/lib/db/client";
import { isMockAuthEnabled, createMockClient, MOCK_USER } from "@/lib/auth/mockAuth";
import { authClient } from "@/lib/auth/client";
import { toAppUser, type AppUser } from "@/lib/auth/types";

type AuthContextValue = {
  user: AppUser | null;
  loading: boolean;
  /**
   * The data client (lib/db/client.ts): every cloud read and write goes
   * through it to POST /api/db, scoped to the session user on the server.
   */
  db: DataClient | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Test-only mock-auth seam (issue #751). `isMockAuthEnabled()` is false in
  // every production build - it short-circuits on `NODE_ENV === "production"`
  // - so this branch is dead code in production. See lib/auth/mockAuth.ts.
  const [mockEnabled] = useState(() => isMockAuthEnabled());
  const [db] = useState<DataClient>(() => (mockEnabled ? createMockClient() : createDataClient()));
  // When the seam is on, start signed-in immediately with the fake user and
  // no loading flicker - there is no session round-trip to wait on.
  const [user, setUser] = useState<AppUser | null>(mockEnabled ? MOCK_USER : null);
  const [loading, setLoading] = useState(!mockEnabled);

  const onSession = useCallback((next: AppUser | null) => {
    setUser(next);
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, db }}>
      {/* The mock seam is fully synchronous: the fake user is already in state. */}
      {!mockEnabled && <SessionSync onSession={onSession} />}
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Follows Better Auth's session (useSession) and reports the signed-in user,
 * with their linked accounts, as an AppUser; null when signed out. Reports
 * again only when the signed-in user changes, not on every session refetch.
 */
function SessionSync({ onSession }: { onSession: (user: AppUser | null) => void }) {
  const { data, isPending } = authClient.useSession();
  const sessionUser = data?.user ?? null;
  const latest = useRef(sessionUser);
  useEffect(() => {
    latest.current = sessionUser;
  });
  const userId = sessionUser?.id ?? null;

  useEffect(() => {
    if (isPending) return;
    const current = latest.current;
    if (!current) {
      onSession(null);
      return;
    }
    let cancelled = false;
    authClient
      .listAccounts()
      .then(({ data: accounts }) => accounts ?? [])
      .catch(() => [])
      .then((accounts) => {
        if (!cancelled) onSession(toAppUser(current, accounts));
      });
    return () => {
      cancelled = true;
    };
  }, [isPending, userId, onSession]);

  return null;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
