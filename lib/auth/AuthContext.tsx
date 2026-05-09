"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  supabase: SupabaseClient;
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
  const [supabase] = useState(() => tryCreateClient());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(supabase !== null);

  useEffect(() => {
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
  }, [supabase]);

  // When Supabase is unavailable supply a non-functional stub that satisfies
  // the context type without crashing. The value is never used when supabase
  // is null because AuthButton renders nothing in the loading state, but
  // useSyncOnUnload guards on userId being non-null.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseValue = (supabase ?? null) as any as SupabaseClient;

  return (
    <AuthContext.Provider value={{ user, loading, supabase: supabaseValue }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
