import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { KNOWN_PUSH_ENDPOINT_PATTERN, isKnownPushEndpoint } from "./endpoints";

const MIGRATION = resolve(__dirname, "../../db/migrations/049_push_subscriptions_limits.sql");

describe("isKnownPushEndpoint", () => {
  it.each([
    "https://web.push.apple.com/QH4",
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("Known hosts: accepts %s", (endpoint) => {
    expect(isKnownPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/x",
    "https://fcm.googleapis.com.example.com/x",
    "https://fcm.googleapis.com@example.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://notpush.apple.com/x",
    "https://push.example/a",
  ])("Lookalike endpoint: refuses %s", (endpoint) => {
    expect(isKnownPushEndpoint(endpoint)).toBe(false);
  });
});

describe("One list", () => {
  it("uses the same pattern in the migration as in the code", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const match = /CHECK \(endpoint ~ '([^']+)'\)/.exec(sql);
    expect(match?.[1]).toBe(KNOWN_PUSH_ENDPOINT_PATTERN);
  });
});
