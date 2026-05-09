"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

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
  // Defer client creation to useEffect so it runs only in the browser.
  // createBrowserClient from @supabase/ssr reads cookies during initialisation;
  // calling it in a useState initialiser triggers Next.js's "Uncached data
  // accessed outside Suspense" error during SSR with cacheComponents enabled.
  const [supabase, setSupabase] = useState<ReturnType<typeof createClient> | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = tryCreateClient();
    setSupabase(client);
    if (!client) {
      setLoading(false);
      return;
    }

    client.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

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
