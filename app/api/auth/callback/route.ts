import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}/auth/callback-complete`);
    }
  }
  return NextResponse.redirect(`${base}/?error=auth`);
}
