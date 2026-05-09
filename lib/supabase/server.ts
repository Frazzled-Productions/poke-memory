import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

// Returns a Supabase client for use in Server Components, Server Actions,
// and Route Handlers. cookies() MUST be awaited in Next.js 16.2.5+.
export async function createClient() {
  const cookieStore = await cookies(); // MUST await in Next.js 16
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll is called in a Server Component context where the response
            // is already sent; silently ignore since auth cookies will be set
            // by the Server Action / Route Handler that initiated the mutation.
          }
        },
      },
    },
  );
}
