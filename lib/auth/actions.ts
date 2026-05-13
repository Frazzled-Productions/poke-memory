"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthProvider } from "./types";

export async function signIn(provider: AuthProvider) {
  if (provider !== "github" && provider !== "google") redirect("/");
  const supabase = await createClient();
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: base + "/api/auth/callback",
    },
  });
  if (error || !data.url) redirect("/");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
