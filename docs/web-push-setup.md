# Web Push setup

Manual one-off setup for the daily review reminder Web Push feature
(issue #1056, migration 028).

## Architecture summary

- `pg_cron` fires once a day (08:00 UTC) and posts to the Vercel route at
  `/api/push/send-daily`.
- The route handler verifies a Bearer token, queries every active
  subscription, fans out per-user pushes via the `web-push` npm package,
  and deletes any subscriptions the push service reports as dead (410 / 404).
- The client subscribes via `pushManager.subscribe()` from inside an
  installed PWA on iOS / Android / desktop Chromium. The opt-in toggle
  lives on the Settings page and is hidden outside `display-mode:
  standalone` or for guests.

## One-off setup checklist

Run these once per environment. All steps are idempotent.

### 1. Generate a VAPID keypair

```
npx web-push generate-vapid-keys
```

This prints two base64url strings:

```
Public Key:  <NEXT_PUBLIC_VAPID_PUBLIC_KEY>
Private Key: <VAPID_PRIVATE_KEY>
```

Keep both somewhere secure (1Password, vault, etc.). The same keypair is
used in Production and Preview unless you want different push channels per
environment.

### 2. Generate a shared cron secret

```
openssl rand -base64 32
```

Use the same value for both `CRON_SHARED_SECRET` (Vercel) and
`cron_shared_secret` (Supabase Vault). They are compared byte-for-byte by
the route handler; any drift means every cron run returns 401.

### 3. Set Vercel environment variables

In the Vercel dashboard for both Production and Preview:

| Name                            | Value                                                 |
| ------------------------------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`  | The public key from step 1                            |
| `VAPID_PRIVATE_KEY`             | The private key from step 1 (server-side only)        |
| `VAPID_SUBJECT`                 | `mailto:hello@pokememory.com` or your contact mailto  |
| `CRON_SHARED_SECRET`            | The base64 string from step 2 (server-side only)      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Already set; the route needs it for cross-user reads  |

Only `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is exposed to the browser. The other
three must NOT be prefixed `NEXT_PUBLIC_`; doing so leaks them to every
client bundle.

### 4. Populate Supabase Vault

Open the Supabase SQL editor and run:

```sql
INSERT INTO vault.secrets (name, secret) VALUES
  ('push_send_url',      'https://pokememory.com/api/push/send-daily'),
  ('cron_shared_secret', '<same value as CRON_SHARED_SECRET>');
```

For preview deployments, replace the URL with the preview deployment's
public URL. The `cron_shared_secret` must match the Vercel env var byte
for byte.

### 5. Verify

After all five steps are in place:

- The Settings page on a signed-in installed PWA shows a "Daily review
  reminder" toggle. Turning it on prompts for notification permission
  and inserts a row into `push_subscriptions`.
- Manually trigger the cron job:

  ```sql
  SELECT cron.run('web-push-daily-reminders');
  ```

  Then check `cron.job_run_details` for the most recent row. A
  successful run shows `succeeded` and posts to the Vercel route.

- Tail Vercel runtime logs for the route. A successful POST returns
  `{ ok: true, sent: N, deleted: M }`.

## Operational notes

- **Subscription cleanup.** The route deletes any subscription that
  returns 410 (Gone) or 404 (Not Found) from the push service. Other
  errors are logged but skipped - a single bad endpoint does not block
  the rest of the batch.
- **Schedule changes.** To move the daily fire time, update the cron
  expression via `cron.alter_job`:

  ```sql
  SELECT cron.alter_job(
    (SELECT jobid FROM cron.job WHERE jobname = 'web-push-daily-reminders'),
    schedule := '0 16 * * *' -- 16:00 UTC
  );
  ```

- **Secret rotation.** Updating `vault.secrets` is enough on the
  Supabase side; the cron command re-reads on every fire. Update the
  Vercel env var in the same change to avoid mid-cycle 401s.
- **Disabling the feature.** Either remove the
  `web-push-daily-reminders` job (`SELECT cron.unschedule('web-push-daily-reminders');`)
  or set `cron_shared_secret` in Vault to an empty string; the route
  will reject every call until the value is restored.
