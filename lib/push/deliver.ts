import webpush from "web-push";
import { isKnownPushEndpoint } from "@/lib/push/endpoints";

const MAX_SENDS_IN_FLIGHT = 20;
/** Library socket timeout. It measures silence, so a slow trickle outlasts it. */
const SOCKET_TIMEOUT_MS = 10_000;
/** Overall limit on one send, which is what stops a slow trickle. */
const SEND_LIMIT_MS = 15_000;
/** No send starts this long after the route started; the rest of its 300 seconds finishes the run. */
const RUN_BUDGET_MS = 240_000;

export type PushTarget = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
};

export type DeliveryResult = {
  sent: number;
  /** Rows the push service reported as gone (404 or 410). The caller deletes them. */
  deadIds: string[];
  /** Devices left when the budget ran out. */
  notReached: number;
  /** Rows on a host outside the known list, skipped and kept. */
  unknownHost: number;
};

/** `web-push` has no abort signal, so a send past the limit is abandoned, not cancelled. */
function withinSendLimit<T>(send: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("push send limit reached")), SEND_LIMIT_MS);
  });
  return Promise.race([send, limit]).finally(() => clearTimeout(timer));
}

/**
 * Sends to every target through a pool of workers, so one slow push service
 * cannot hold up the others, and returns once every started send has ended.
 * `startedAt` is when the route started: the budget includes its reads.
 */
export async function deliverPushes<T extends PushTarget>(
  targets: T[],
  buildPayload: (target: T) => unknown,
  startedAt: number,
): Promise<DeliveryResult> {
  const known = targets.filter((target) => isKnownPushEndpoint(target.endpoint));
  const result: DeliveryResult = {
    sent: 0,
    deadIds: [],
    notReached: 0,
    unknownHost: targets.length - known.length,
  };

  let next = 0;
  async function worker() {
    while (next < known.length && Date.now() - startedAt < RUN_BUDGET_MS) {
      const target = known[next++];
      try {
        const send = async () =>
          webpush.sendNotification(
            {
              endpoint: target.endpoint,
              keys: { p256dh: target.p256dh, auth: target.auth_secret },
            },
            JSON.stringify(await buildPayload(target)),
            { timeout: SOCKET_TIMEOUT_MS },
          );
        await withinSendLimit(send());
        result.sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          result.deadIds.push(target.id);
          continue;
        }
        // Transient or non-fatal: a single bad device must not stop the run.
        console.warn("[push] sendNotification failed", { id: target.id, status });
      }
    }
  }
  await Promise.all(Array.from({ length: MAX_SENDS_IN_FLIGHT }, worker));

  result.notReached = known.length - next;
  if (result.notReached > 0) {
    console.warn("[push] devices not reached", { notReached: result.notReached });
  }
  if (result.unknownHost > 0) {
    console.warn("[push] rows on an unknown host skipped", { unknownHost: result.unknownHost });
  }
  return result;
}
