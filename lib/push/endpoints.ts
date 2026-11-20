/**
 * The push services a subscription may point at (ops #380). The database
 * repeats this pattern in migration 049 because SQL cannot import it; the
 * "One list" test in endpoints.test.ts fails if the two differ.
 */
export const KNOWN_PUSH_ENDPOINT_PATTERN = String.raw`^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/`;

const KNOWN_PUSH_ENDPOINT = new RegExp(KNOWN_PUSH_ENDPOINT_PATTERN);

export function isKnownPushEndpoint(endpoint: string): boolean {
  return KNOWN_PUSH_ENDPOINT.test(endpoint);
}
