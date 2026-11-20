/**
 * One operator alert email through the Resend REST API (design D10 and D13): a failed backup export or
 * restore check, and the daily grade_log divergence check. Same shape as koinori-web's
 * worker/failure-alert.ts.
 *
 * Sends from RESEND_FROM (a plain var on the production Worker) to the company address, with the
 * Worker secret RESEND_API_KEY, set at the cutover on the production Worker only. pokememory.com is
 * not verified in Resend, so the sender is a frazzledproductions.com address. It never throws: a
 * missing key, a refusal or a network error is logged as "<tag>: alert not sent: <reason>" and the
 * caller carries on (rethrows, or answers its error status). The email holds counts, keys and masked
 * user id prefixes, never row data.
 */

export const ALERT_TO = "hello@frazzledproductions.com";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/** Used when RESEND_FROM is unset. */
export const ALERT_FROM_FALLBACK = "Poké Memory <hello@frazzledproductions.com>";

export interface AlertEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

export interface Alert {
  /** Log prefix, such as "d1-backup". */
  tag: string;
  subject: string;
  text: string;
}

export async function sendAlertEmail(
  env: AlertEnv,
  alert: Alert,
  { fetch: send = fetch, out = console }: { fetch?: typeof fetch; out?: Pick<Console, "error"> } = {},
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    out.error(`${alert.tag}: alert not sent: no RESEND_API_KEY`);
    return false;
  }
  try {
    const response = await send(RESEND_EMAILS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.RESEND_FROM ?? ALERT_FROM_FALLBACK,
        to: [ALERT_TO],
        subject: alert.subject,
        text: alert.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // Drain the body so the runtime can release the response.
    await response.text().catch(() => undefined);
    if (!response.ok) {
      out.error(`${alert.tag}: alert not sent: Resend answered ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    out.error(`${alert.tag}: alert not sent: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
