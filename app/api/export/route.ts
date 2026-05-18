/**
 * GET /api/export
 *
 * Exports the authenticated user's review history as a CSV file, satisfying
 * GDPR's right to data portability. Reads from the `grade_log` table via the
 * RLS-protected Supabase client — only the requesting user's own rows are
 * returned.
 *
 * CSV columns: date, pokemon, card_type, grade, grade_label
 *
 * - date         ISO date of the review (YYYY-MM-DD, UTC)
 * - pokemon      Human-readable Pokémon name or evolution edge description
 * - card_type    One of: name | reverse | cry | evolution | reverse-evolution
 * - grade        Numeric FSRS grade (1=Again, 2=Hard, 4=Good, 5=Easy)
 * - grade_label  Human-readable grade label (Again, Hard, Good, Easy)
 *
 * Guest users (no session) receive 401. Supabase errors produce 503.
 */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { SEED_POKEMON } from "@/lib/pokemon/seed";
import { Subject } from "@/lib/cards/subjectKey";

// Build a lookup map once at module load — derived from static seed data so
// the cost is paid once per cold start, not per request.
const nameById = new Map<number, string>(
  SEED_POKEMON.map((p) => [p.id, p.displayName]),
);

/**
 * Human-readable label for a grade_log row's (card_type, subject_key) pair.
 * Falls back to subject_key verbatim when a name cannot be resolved (e.g. a
 * card type introduced after this deployment, or a legacy null subject_key).
 */
function resolveLabel(cardType: string, subjectKey: string | null): string {
  if (!subjectKey) return "";

  try {
    if (
      cardType === "name" ||
      cardType === "reverse" ||
      cardType === "cry"
    ) {
      const id = Subject.parseSpecies(subjectKey);
      return nameById.get(id) ?? subjectKey;
    }

    if (
      cardType === "evolution-edge" ||
      cardType === "reverse-evolution-edge"
    ) {
      const { fromId, toId } = Subject.parseEdge(subjectKey);
      const fromName = nameById.get(fromId) ?? String(fromId);
      const toName = nameById.get(toId) ?? String(toId);
      return `${fromName} -> ${toName}`;
    }
  } catch {
    // Fall through to verbatim fallback below.
  }

  return subjectKey;
}

/** Escapes a single CSV field value: wraps in quotes when necessary. */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Wrap in double-quotes when the field contains a comma, double-quote, or
  // newline; escape inner double-quotes by doubling them (RFC 4180).
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

type GradeLogCloudRow = {
  occurred_at: number;
  entry_date: string;
  card_type: string;
  grade: number;
  subject_key: string | null;
};

/** Maps a numeric FSRS grade to a human-readable label. */
const GRADE_LABELS: Record<number, string> = {
  1: "Again",
  2: "Hard",
  4: "Good",
  5: "Easy",
};

export async function GET(): Promise<NextResponse> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fetch all grade_log rows for this user, ordered chronologically so the
  // CSV reads in review order.
  let rows: GradeLogCloudRow[];
  try {
    const { data, error } = await supabase
      .from("grade_log")
      .select("occurred_at,entry_date,card_type,grade,subject_key")
      .eq("user_id", user.id)
      .order("entry_date", { ascending: true })
      .order("occurred_at", { ascending: true });

    if (error || !data) {
      console.error("[/api/export] grade_log fetch failed", error);
      return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
    }

    rows = data as GradeLogCloudRow[];
  } catch (err) {
    console.error("[/api/export] unexpected error", err);
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Build the CSV content.
  const lines: string[] = [];

  // Header row — snake_case column names for machine readability.
  lines.push("date,pokemon,card_type,grade,grade_label");

  for (const row of rows) {
    const label = resolveLabel(row.card_type, row.subject_key);

    // Map DB card_type slugs back to the app-internal names shown in the UI:
    // "evolution-edge" → "evolution", "reverse-evolution-edge" → "reverse-evolution".
    const uiCardType =
      row.card_type === "evolution-edge"
        ? "evolution"
        : row.card_type === "reverse-evolution-edge"
          ? "reverse-evolution"
          : row.card_type;

    const gradeLabel = GRADE_LABELS[row.grade] ?? String(row.grade);

    lines.push(
      [
        csvField(row.entry_date),
        csvField(label),
        csvField(uiCardType),
        csvField(row.grade),
        csvField(gradeLabel),
      ].join(","),
    );
  }

  const csv = lines.join("\r\n");

  // ISO date stamp in the filename so saved files are easy to distinguish.
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `poke-memory-reviews-${dateStamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Do not cache — each request should reflect the user's latest data.
      "Cache-Control": "no-store",
    },
  });
}
