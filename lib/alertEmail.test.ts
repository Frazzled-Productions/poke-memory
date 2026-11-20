/**
 * The operator alert email (lib/alertEmail.ts; design D10 and D13). A fake fetch stands in for
 * Resend: no test calls it.
 */
import { describe, expect, it, vi } from "vitest";
import { ALERT_FROM_FALLBACK, ALERT_TO, RESEND_EMAILS_URL, sendAlertEmail } from "./alertEmail";

const ALERT = { tag: "d1-backup", subject: "Poké Memory: D1 export FAILED", text: "d1-backup: export FAILED: boom" };
const ENV = { RESEND_API_KEY: "re_test", RESEND_FROM: "Poké Memory <hello@frazzledproductions.com>" };

function sink() {
  const lines: string[] = [];
  return { lines, out: { error: (m: string) => void lines.push(m) } };
}

describe("sendAlertEmail", () => {
  it("sends one email through the Resend REST API to the company address", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    const { lines, out } = sink();
    await expect(sendAlertEmail(ENV, ALERT, { fetch, out })).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.resend.com/emails");
    expect(RESEND_EMAILS_URL).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "Poké Memory <hello@frazzledproductions.com>",
      to: ["hello@frazzledproductions.com"],
      subject: ALERT.subject,
      text: ALERT.text,
    });
    expect(ALERT_TO).toBe("hello@frazzledproductions.com");
    expect(lines).toEqual([]);
  });

  it("falls back to a frazzledproductions.com sender (pokememory.com is not verified in Resend)", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    await sendAlertEmail({ RESEND_API_KEY: "re_test" }, ALERT, { fetch, out: sink().out });
    expect(ALERT_FROM_FALLBACK).toMatch(/@frazzledproductions\.com>$/);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).from).toBe(ALERT_FROM_FALLBACK);
  });

  it("logs 'alert not sent: no RESEND_API_KEY' and calls nothing when the secret is missing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { lines, out } = sink();
    await expect(sendAlertEmail({ RESEND_FROM: ENV.RESEND_FROM }, ALERT, { fetch, out })).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(lines).toEqual(["d1-backup: alert not sent: no RESEND_API_KEY"]);
  });

  it("logs and does not throw when Resend refuses the email", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}", { status: 422 }));
    const { lines, out } = sink();
    await expect(sendAlertEmail(ENV, ALERT, { fetch, out })).resolves.toBe(false);
    expect(lines).toEqual(["d1-backup: alert not sent: Resend answered 422"]);
  });

  it("logs and does not throw when the request itself fails", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("network down"));
    const { lines, out } = sink();
    await expect(sendAlertEmail(ENV, ALERT, { fetch, out })).resolves.toBe(false);
    expect(lines).toEqual(["d1-backup: alert not sent: network down"]);
  });
});
