## REMOVED Requirements

### Requirement: A missing key stops the client (baseline, current behaviour)

**Reason**: No Supabase client or key remains after the move to Cloudflare Workers and D1.

**Migration**: Configuration lives in Worker bindings and secrets (`hosting-and-data`); a route with a
missing binding or secret keeps its misconfigured answer (`push-notifications`,
`feedback-and-operator-tools`).

### Requirement: The publishable key wins, the legacy anon key is the fallback

**Reason**: The browser no longer talks to Supabase; it reaches D1 only through the data gateway.

**Migration**: The gateway and the scope helper in `hosting-and-data` replace the low-privilege key and
row-level security.

### Requirement: The secret key wins, the legacy service_role key is the fallback

**Reason**: The server routes no longer use a Supabase secret key.

**Migration**: Cross-user work uses `lib/db/system.ts` on the Worker's D1 binding (`hosting-and-data`).
