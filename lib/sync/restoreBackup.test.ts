import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planSignedInRestore, type CloudRow } from "@/lib/sync/cloud";
import { restoreBackupSignedIn } from "./restoreBackup";
import { initialReviewState, type ReviewState } from "@/lib/srs/scheduler";
import { DEFAULT_LIMITS, type ReviewableCard } from "@/lib/review/session";
import { DEFAULT_SETTINGS } from "@/lib/settings/persistence";

const mocks = vi.hoisted(() => ({
  pullSession: vi.fn(),
  pushSession: vi.fn(),
  pullUserSettingsRow: vi.fn(),
  loadSession: vi.fn(),
  saveSession: vi.fn(),
  loadPendingQueue: vi.fn(),
  savePendingQueue: vi.fn(),
  markPushSucceeded: vi.fn(),
}));

vi.mock("@/lib/sync/cloud", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/cloud")>()),
  pullSession: mocks.pullSession,
  pushSession: mocks.pushSession,
}));
vi.mock("@/lib/sync/settings", () => ({ pullUserSettingsRow: mocks.pullUserSettingsRow }));
vi.mock("@/lib/sync/persistence", () => ({
  loadPendingQueue: mocks.loadPendingQueue,
  savePendingQueue: mocks.savePendingQueue,
  markPushSucceeded: mocks.markPushSucceeded,
}));
vi.mock("@/lib/review/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/review/persistence")>()),
  loadSession: mocks.loadSession,
  saveSession: mocks.saveSession,
}));

const client = {} as SupabaseClient;

function reviewed(reps: number, lastReview: string): Partial<ReviewState> {
  return {
    stability: 5,
    difficulty: 5,
    scheduledDays: 7,
    reps,
    fsrsState: "review",
    lastReview,
    firstSeen: "2026-01-01",
  };
}

function card(id: number, state: Partial<ReviewState> = {}): ReviewableCard {
  return {
    id,
    name: `Card ${id}`,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    cardType: "name",
    subjectKey: String(id),
    locale: "en",
    state: { ...initialReviewState(new Date("2026-06-01")), ...state },
  } as unknown as ReviewableCard;
}

function row(id: number, reps: number, lastReview: string): CloudRow {
  return {
    card_type: "name",
    subject_key: String(id),
    locale: "en",
    stability: 5,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 7,
    reps,
    lapses: 0,
    fsrs_state: "review",
    due_date: "2026-06-01",
    last_review: lastReview,
    first_seen: "2026-01-01",
    hidden_since: null,
    seen_in_pasture: false,
  };
}

function repsById(cards: ReviewableCard[]): Record<number, number> {
  return Object.fromEntries(cards.map((c) => [c.id, c.state.reps]));
}

describe("planSignedInRestore", () => {
  it("uses and pushes a backup card that is further on than the cloud and this device", () => {
    const { cards, toPush } = planSignedInRestore(
      [card(1, reviewed(9, "2026-05-01"))],
      [card(1, reviewed(4, "2026-03-01"))],
      [row(1, 4, "2026-03-01")],
      null,
    );
    expect(repsById(cards)).toEqual({ 1: 9 });
    expect(repsById(toPush)).toEqual({ 1: 9 });
  });

  it("keeps this device's copy when the cloud is further on than the backup", () => {
    const { cards, toPush } = planSignedInRestore(
      [card(1, reviewed(4, "2026-03-01"))],
      [card(1, reviewed(9, "2026-05-01"))],
      [row(1, 9, "2026-05-01")],
      null,
    );
    expect(repsById(cards)).toEqual({ 1: 9 });
    expect(toPush).toEqual([]);
  });

  it("takes the cloud row for a card this device lacks when the cloud is further on", () => {
    const { cards, toPush } = planSignedInRestore(
      [card(1, reviewed(4, "2026-03-01"))],
      [],
      [row(1, 9, "2026-05-01")],
      null,
    );
    expect(repsById(cards)).toEqual({ 1: 9 });
    expect(toPush).toEqual([]);
  });

  it("keeps a local grade that is ahead of the backup, even when the backup beats the cloud", () => {
    const { cards, toPush } = planSignedInRestore(
      [card(1, reviewed(5, "2026-04-01"))],
      [card(1, reviewed(6, "2026-05-01"))],
      [row(1, 4, "2026-03-01")],
      null,
    );
    expect(repsById(cards)).toEqual({ 1: 6 });
    expect(toPush).toEqual([]);
  });

  it("does not push a copy identical to the cloud", () => {
    const { toPush } = planSignedInRestore(
      [card(1, reviewed(4, "2026-03-01"))],
      [card(1, reviewed(4, "2026-03-01"))],
      [row(1, 4, "2026-03-01")],
      null,
    );
    expect(toPush).toEqual([]);
  });

  it("adds a pristine backup card without pushing it", () => {
    const { cards, toPush } = planSignedInRestore([card(2)], [card(1)], [], null);
    expect(cards.map((c) => c.id).sort()).toEqual([1, 2]);
    expect(toPush).toEqual([]);
  });

  it("does not push an in-step card (first seen, never graduated)", () => {
    const { cards, toPush } = planSignedInRestore(
      [card(2, { firstSeen: "2026-05-01" })],
      [],
      [],
      null,
    );
    expect(cards).toHaveLength(1);
    expect(toPush).toEqual([]);
  });

  it("leaves out a card dated before the last reset, by first seen or by last review", () => {
    const { cards, toPush } = planSignedInRestore(
      [
        card(1, reviewed(4, "2026-03-01")),
        card(2, { ...reviewed(4, "2026-06-01"), firstSeen: "2026-03-01" }),
        card(3, { ...reviewed(4, "2026-06-01"), firstSeen: "2026-05-02" }),
      ],
      [],
      [],
      "2026-05-02T10:00:00+00:00",
    );
    expect(cards.map((c) => c.id)).toEqual([3]);
    expect(toPush.map((c) => c.id)).toEqual([3]);
  });

  it("matches by locale, so a Japanese card leaves the English row alone", () => {
    const ja = { ...card(1, reviewed(9, "2026-05-01")), locale: "ja" } as ReviewableCard;
    const { cards, toPush } = planSignedInRestore(
      [ja],
      [card(1, reviewed(4, "2026-03-01"))],
      [row(1, 4, "2026-03-01")],
      null,
    );
    expect(cards.map((c) => [c.locale, c.state.reps])).toEqual([
      ["en", 4],
      ["ja", 9],
    ]);
    expect(toPush.map((c) => c.locale)).toEqual(["ja"]);
  });

  it("does not push a later card with fewer reps, which the trigger would refuse", () => {
    const { toPush } = planSignedInRestore(
      [card(1, { ...reviewed(3, "2026-05-01") })],
      [],
      [row(1, 4, "2026-03-01")],
      null,
    );
    expect(toPush).toEqual([]);
  });
});

describe("restoreBackupSignedIn", () => {
  const data = (cards: ReviewableCard[]) => ({
    cards,
    limits: DEFAULT_LIMITS,
    settings: DEFAULT_SETTINGS,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pullSession.mockResolvedValue([]);
    mocks.pushSession.mockResolvedValue(true);
    mocks.pullUserSettingsRow.mockResolvedValue(null);
    mocks.loadSession.mockResolvedValue(null);
    mocks.saveSession.mockResolvedValue({ ok: true });
    mocks.loadPendingQueue.mockReturnValue([]);
  });

  it("writes nothing when the pull fails", async () => {
    mocks.pullSession.mockResolvedValue(null);
    const result = await restoreBackupSignedIn(client, "u", data([card(1)]));
    expect(result).toEqual({ ok: false, reason: "pull-failed" });
    expect(mocks.saveSession).not.toHaveBeenCalled();
    expect(mocks.pushSession).not.toHaveBeenCalled();
  });

  it("does not push when the session cannot be saved", async () => {
    mocks.saveSession.mockResolvedValue({ ok: false, reason: "quota" });
    const result = await restoreBackupSignedIn(
      client,
      "u",
      data([card(1, reviewed(3, "2026-05-01"))]),
    );
    expect(result).toEqual({ ok: false, reason: "save-failed" });
    expect(mocks.pushSession).not.toHaveBeenCalled();
  });

  it("saves, pushes and records the push, keeping this device's limits", async () => {
    const limits = { ...DEFAULT_LIMITS, name: { maxNewPerDay: 1, maxReviewsPerDay: 2 } };
    mocks.loadSession.mockResolvedValue({ cards: [], limits });
    const result = await restoreBackupSignedIn(
      client,
      "u",
      data([card(1, reviewed(3, "2026-05-01"))]),
    );
    expect(result).toEqual({ ok: true });
    expect(mocks.saveSession.mock.calls[0][0].limits).toBe(limits);
    expect(mocks.pushSession.mock.calls[0][2].map((c: ReviewableCard) => c.id)).toEqual([1]);
    expect(mocks.markPushSucceeded).toHaveBeenCalledOnce();
    expect(mocks.savePendingQueue).not.toHaveBeenCalled();
  });

  it("takes the backup's limits on a device with no session", async () => {
    await restoreBackupSignedIn(client, "u", data([card(1)]));
    expect(mocks.saveSession.mock.calls[0][0].limits).toBe(DEFAULT_LIMITS);
  });

  it("does not push when nothing is further on", async () => {
    await restoreBackupSignedIn(client, "u", data([card(1)]));
    expect(mocks.pushSession).not.toHaveBeenCalled();
  });

  it("queues the restored cards when the push fails, keeping other waiting grades", async () => {
    mocks.pushSession.mockResolvedValue(false);
    mocks.loadPendingQueue.mockReturnValue([
      card(1, reviewed(1, "2026-02-01")),
      card(7, reviewed(2, "2026-02-01")),
    ]);
    await restoreBackupSignedIn(client, "u", data([card(1, reviewed(3, "2026-05-01"))]));
    const queued = mocks.savePendingQueue.mock.calls[0][0] as ReviewableCard[];
    expect(repsById(queued)).toEqual({ 1: 3, 7: 2 });
    expect(mocks.markPushSucceeded).not.toHaveBeenCalled();
  });

  it("brings an older card shape up to date, and drops one with no cloud identity", async () => {
    const { subjectKey: _drop, ...noKey } = card(1, reviewed(3, "2026-05-01")) as ReviewableCard & {
      subjectKey?: string;
    };
    const legacyEvolution = {
      id: 99,
      cardType: "evolution",
      state: reviewed(3, "2026-05-01"),
    } as unknown as ReviewableCard;
    await restoreBackupSignedIn(client, "u", data([noKey as ReviewableCard, legacyEvolution]));
    const pushed = mocks.pushSession.mock.calls[0][2] as ReviewableCard[];
    expect(pushed.map((c) => c.subjectKey)).toEqual(["1"]);
  });

  it("uses the account's last reset as the cut-off", async () => {
    mocks.pullUserSettingsRow.mockResolvedValue({
      settings: null,
      updatedAt: null,
      lastResetAt: "2026-05-02T00:00:00+00:00",
    });
    await restoreBackupSignedIn(client, "u", data([card(1, reviewed(3, "2026-03-01"))]));
    expect(mocks.pushSession).not.toHaveBeenCalled();
  });
});
