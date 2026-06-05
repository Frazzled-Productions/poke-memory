"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { isMockAuthEnabled, createMockClient, MOCK_USER } from "@/lib/auth/mockAuth";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  supabase: SupabaseClient | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Returns null when the Supabase env vars are absent (e.g. CI builds,
// local dev without credentials). In that case the AuthProvider renders
// children normally with no auth state, so the rest of the app works.
function tryCreateClient(): ReturnType<typeof createClient> | null {
  try {
    return createClient();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Test-only mock-auth seam (issue #751). `isMockAuthEnabled()` is false in
  // every production build - it short-circuits on `NODE_ENV === "production"`
  // - so this branch is dead code in production. See lib/auth/mockAuth.ts.
  const [mockEnabled] = useState(() => isMockAuthEnabled());
  const [supabase] = useState(() =>
    mockEnabled ? createMockClient() : tryCreateClient(),
  );
  // When the seam is on, start signed-in immediately with the fake user and
  // no loading flicker - there is no async getUser round-trip to wait on.
  const [user, setUser] = useState<User | null>(mockEnabled ? MOCK_USER : null);
  const [loading, setLoading] = useState(mockEnabled ? false : supabase !== null);

  useEffect(() => {
    // The mock seam is fully synchronous: the fake user is already in state.
    // Skip the getUser / onAuthStateChange wiring entirely.
    if (mockEnabled) return;
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase, mockEnabled]);

  return (
    <AuthContext.Provider value={{ user, loading, supabase }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
