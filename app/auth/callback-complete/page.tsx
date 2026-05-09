"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { hasCloudData, pullSession, pushSession } from "@/lib/sync/cloud";
import { loadSession, saveSession } from "@/lib/review/persistence";
import { DEFAULT_LIMITS } from "@/lib/review/session";
import type { CloudRow } from "@/lib/sync/cloud";
import type { ReviewableCard } from "@/lib/review/session";

type Status =
  | { kind: "loading" }
  | { kind: "conflict"; localCards: ReviewableCard[]; cloudRows: CloudRow[] }
  | { kind: "error" };

function summarise(cards: ReviewableCard[]) {
  const reviewed = cards.filter((c) => c.state.lastReview !== null);
  const latest = reviewed.map((c) => c.state.lastReview as string).sort().at(-1) ?? null;
  return { count: reviewed.length, latest };
}

function summariseCloud(rows: CloudRow[]) {
  const reviewed = rows.filter((r) => r.last_review !== null);
  const latest = reviewed.map((r) => r.last_review as string).sort().at(-1) ?? null;
  return { count: reviewed.length, latest };
}

function mergeCloudIntoLocal(local: ReviewableCard[], cloud: CloudRow[]): ReviewableCard[] {
  const byId = new Map(cloud.map((r) => [r.pokemon_id, r]));
  return local.map((card) => {
    const row = byId.get(card.id);
    if (!row) return card;
    return { ...card, state: { ...card.state, repetitions: row.repetitions, interval: row.interval, easeFactor: row.ease_factor, dueDate: row.due_date, lastReview: row.last_review, firstSeen: row.first_seen } };
  });
}

export default function CallbackCompletePage() {
  const router = useRouter();
  const { user, loading, supabase } = useAuth();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [pending, setPending] = useState(false);
  const [pushWarning, setPushWarning] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/"); return; }
    if (!supabase) { router.replace("/"); return; }
    let cancelled = false;
    async function resolve() {
      if (!supabase || !user) return;
      const localSession = loadSession();
      const hasLocal = localSession !== null && localSession.cards.some((c) => c.state.lastReview !== null);
      let cloudRows: CloudRow[] | null = null;
      try {
        const hasCloud = await hasCloudData(supabase, user.id);
        if (hasCloud) {
          cloudRows = await pullSession(supabase, user.id);
          if (cloudRows === null) {
            if (!cancelled) setStatus({ kind: "error" });
            return;
          }
        }
      } catch {
        if (!cancelled) setStatus({ kind: "error" });
        return;
      }
      if (cancelled) return;
      const cloudHasData = cloudRows !== null && cloudRows.length > 0;
      if (!hasLocal && !cloudHasData) { router.replace("/"); return; }
      if (hasLocal && !cloudHasData) {
        const ok = await pushSession(supabase, user.id, localSession!.cards);
        if (!ok && !cancelled) setPushWarning("Sync failed — your progress is safe locally.");
        router.replace("/");
        return;
      }
      if (!hasLocal && cloudHasData) {
        const fresh = loadSession();
        if (fresh !== null) {
          const merged = mergeCloudIntoLocal(fresh.cards, cloudRows!);
          saveSession({ cards: merged, limits: DEFAULT_LIMITS });
        }
        router.replace("/");
        return;
      }
      setStatus({ kind: "conflict", localCards: localSession!.cards, cloudRows: cloudRows! });
    }
    void resolve();
    return () => { cancelled = true; };
  }, [loading, user, supabase, router]);

  async function handleKeepLocal() {
    if (status.kind !== "conflict" || !user || !supabase || pending) return;
    setPending(true);
    const ok = await pushSession(supabase, user.id, status.localCards);
    if (!ok) setPushWarning("Sync failed — your progress is safe locally.");
    router.replace("/");
  }

  function handleKeepCloud() {
    if (status.kind !== "conflict" || pending) return;
    const local = loadSession();
    if (local !== null) {
      const merged = mergeCloudIntoLocal(local.cards, status.cloudRows);
      saveSession({ cards: merged, limits: local.limits });
    }
    router.replace("/");
  }

  if (status.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center" aria-busy="true" aria-label="Checking sync status">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-foreground" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking sync status…</p>
        </div>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <p className="text-lg font-semibold text-foreground">Could not reach the cloud</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">There was a network error while checking your cloud progress.</p>
          <button type="button" onClick={() => setStatus({ kind: "loading" })} className="min-h-[44px] rounded-lg bg-foreground px-6 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const localSummary = summarise(status.localCards);
  const cloudSummary = summariseCloud(status.cloudRows);
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl font-bold text-foreground text-center">Sync conflict</h1>
        <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
          You have progress on this device and in the cloud. Which would you like to keep?
        </p>
        {pushWarning && (
          <p className="mt-4 text-center text-sm text-amber-600 dark:text-amber-400">{pushWarning}</p>
        )}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-background p-6 dark:border-zinc-800">
            <h2 className="text-base font-semibold text-foreground">This device</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {localSummary.count} card{localSummary.count !== 1 ? "s" : ""} reviewed
            </p>
            {localSummary.latest && (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Last reviewed: {localSummary.latest}</p>
            )}
            <button
              type="button"
              onClick={handleKeepLocal}
              disabled={pending}
              className="mt-4 w-full min-h-[44px] rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Keep local
            </button>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-background p-6 dark:border-zinc-800">
            <h2 className="text-base font-semibold text-foreground">Cloud</h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {cloudSummary.count} card{cloudSummary.count !== 1 ? "s" : ""} reviewed
            </p>
            {cloudSummary.latest && (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Last reviewed: {cloudSummary.latest}</p>
            )}
            <button
              type="button"
              onClick={handleKeepCloud}
              disabled={pending}
              className="mt-4 w-full min-h-[44px] rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50"
            >
              Keep cloud
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
