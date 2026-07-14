import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewableCard } from "@/lib/review/session";
import { pushWithFallback } from "./pushWithFallback";
import { pushSingleCard } from "@/lib/sync/cloud";
import {
  loadPendingQueue,
  savePendingQueue,
  clearPendingQueue,
} from "@/lib/sync/persistence";
import { loadSession } from "@/lib/review/persistence";

vi.mock("@/lib/sync/cloud", () => ({
  pushSingleCard: vi.fn(),
}));

vi.mock("@/lib/sync/persistence", () => ({
  loadPendingQueue: vi.fn(() => []),
  savePendingQueue: vi.fn(),
  clearPendingQueue: vi.fn(),
}));

vi.mock("@/lib/review/persistence", () => ({
  loadSession: vi.fn(async () => null),
}));

vi.mock("@/lib/review/session", () => ({
  todayString: vi.fn(() => "2026-07-14"),
}));

const client = {} as SupabaseClient;
const userId = "user-1";

function card(subjectKey: string, lastReview: string | null): ReviewableCard {
  return {
    cardType: "name",
    subjectKey,
    state: { lastReview },
  } as unknown as ReviewableCard;
}

const LIMITS = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPendingQueue).mockReturnValue([]);
  vi.mocked(loadSession).mockResolvedValue(null);
});

describe("pushWithFallback - persisted-queue leg", () => {
  it("pushes the persisted queue and clears it on full success", async () => {
    const q = [card("species:1", "2026-07-14"), card("species:2", "2026-07-14")];
    vi.mocked(loadPendingQueue).mockReturnValue(q);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 2,
    });

    expect(outcome).toEqual({ kind: "queue", failedCards: [] });
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(clearPendingQueue)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(savePendingQueue)).not.toHaveBeenCalled();
    expect(vi.mocked(loadSession)).not.toHaveBeenCalled();
  });

  it("slims the queue to only the failed cards on partial success", async () => {
    const ok = card("species:1", "2026-07-14");
    const failed = card("species:2", "2026-07-14");
    vi.mocked(loadPendingQueue).mockReturnValue([ok, failed]);
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("failed");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 2,
    });

    expect(outcome).toEqual({ kind: "queue", failedCards: [failed] });
    expect(vi.mocked(savePendingQueue)).toHaveBeenCalledWith([failed]);
    expect(vi.mocked(clearPendingQueue)).not.toHaveBeenCalled();
  });

  it("treats a rejected promise as failed but evicts a 'rejected' result", async () => {
    const rejectedPromise = card("species:1", "2026-07-14");
    const evicted = card("species:2", "2026-07-14");
    vi.mocked(loadPendingQueue).mockReturnValue([rejectedPromise, evicted]);
    vi.mocked(pushSingleCard)
      .mockRejectedValueOnce(new Error("network"))
      // "rejected" = regression trigger; the cloud row is newer, evict it.
      .mockResolvedValueOnce("rejected");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 2,
    });

    expect(outcome).toEqual({ kind: "queue", failedCards: [rejectedPromise] });
    expect(vi.mocked(savePendingQueue)).toHaveBeenCalledWith([rejectedPromise]);
  });

  it("returns cancelled before pushing when isCancelled is already true", async () => {
    vi.mocked(loadPendingQueue).mockReturnValue([card("species:1", "2026-07-14")]);

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 1,
      isCancelled: () => true,
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(vi.mocked(pushSingleCard)).not.toHaveBeenCalled();
  });

  it("returns cancelled after the queue push without touching the queue", async () => {
    vi.mocked(loadPendingQueue).mockReturnValue([card("species:1", "2026-07-14")]);
    let cancelled = false;
    vi.mocked(pushSingleCard).mockImplementation(async () => {
      cancelled = true;
      return "ok";
    });

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 1,
      isCancelled: () => cancelled,
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(vi.mocked(savePendingQueue)).not.toHaveBeenCalled();
    expect(vi.mocked(clearPendingQueue)).not.toHaveBeenCalled();
  });
});

describe("pushWithFallback - session fallback leg", () => {
  it("skips the session leg when failedCardCount is 0 and skipSessionWhenCountZero is set", async () => {
    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 0,
      skipSessionWhenCountZero: true,
    });

    expect(outcome).toEqual({ kind: "session-skipped" });
    expect(vi.mocked(loadSession)).not.toHaveBeenCalled();
  });

  it("pushes all reviewed cards when failedCardCount is null (legacy fallback)", async () => {
    const reviewed = card("species:1", "2026-07-01");
    const unreviewed = card("species:2", null);
    vi.mocked(loadSession).mockResolvedValue({
      cards: [reviewed, unreviewed],
      limits: LIMITS,
    } as never);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: null,
    });

    expect(outcome).toEqual({ kind: "session", anyFailed: false });
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledWith(client, userId, reviewed);
  });

  it("prefers today's reviewed cards when failedCardCount > 0", async () => {
    const todayCard = card("species:1", "2026-07-14");
    const oldCard = card("species:2", "2026-07-01");
    vi.mocked(loadSession).mockResolvedValue({
      cards: [todayCard, oldCard],
      limits: LIMITS,
    } as never);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 1,
    });

    expect(outcome).toEqual({ kind: "session", anyFailed: false });
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledWith(client, userId, todayCard);
  });

  it("falls back to all reviewed cards when the today-filter matches nothing", async () => {
    const oldCard1 = card("species:1", "2026-07-01");
    const oldCard2 = card("species:2", "2026-07-02");
    vi.mocked(loadSession).mockResolvedValue({
      cards: [oldCard1, oldCard2],
      limits: LIMITS,
    } as never);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 2,
    });

    expect(outcome).toEqual({ kind: "session", anyFailed: false });
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledTimes(2);
  });

  it("applies the isCardEligible predicate on top of the reviewed filter", async () => {
    const safe = card("species:1", "2026-07-01");
    const unsafe = card("species:2", "2026-07-01");
    vi.mocked(loadSession).mockResolvedValue({
      cards: [safe, unsafe],
      limits: LIMITS,
    } as never);
    vi.mocked(pushSingleCard).mockResolvedValue("ok");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: null,
      isCardEligible: (c) => c.subjectKey === "species:1",
    });

    expect(outcome).toEqual({ kind: "session", anyFailed: false });
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pushSingleCard)).toHaveBeenCalledWith(client, userId, safe);
  });

  it("returns session-empty when nothing is eligible to push", async () => {
    vi.mocked(loadSession).mockResolvedValue(null);

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: null,
    });

    expect(outcome).toEqual({ kind: "session-empty" });
    expect(vi.mocked(pushSingleCard)).not.toHaveBeenCalled();
  });

  it("reports anyFailed when any session push fails", async () => {
    const c1 = card("species:1", "2026-07-14");
    const c2 = card("species:2", "2026-07-14");
    vi.mocked(loadSession).mockResolvedValue({
      cards: [c1, c2],
      limits: LIMITS,
    } as never);
    vi.mocked(pushSingleCard)
      .mockResolvedValueOnce("ok")
      .mockResolvedValueOnce("failed");

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 2,
    });

    expect(outcome).toEqual({ kind: "session", anyFailed: true });
  });

  it("returns cancelled after the session push settles", async () => {
    const c1 = card("species:1", "2026-07-14");
    vi.mocked(loadSession).mockResolvedValue({
      cards: [c1],
      limits: LIMITS,
    } as never);
    let cancelled = false;
    vi.mocked(pushSingleCard).mockImplementation(async () => {
      cancelled = true;
      return "ok";
    });

    const outcome = await pushWithFallback(client, userId, {
      failedCardCount: 1,
      isCancelled: () => cancelled,
    });

    expect(outcome).toEqual({ kind: "cancelled" });
  });
});
