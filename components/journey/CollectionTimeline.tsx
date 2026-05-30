"use client";

/**
 * CollectionTimeline — the hero scrubber on the Journey tab.
 *
 * Allows the user to drag through time in both directions:
 *   Left (past): replay how the collection was built, day by day.
 *   Right (future): the forgetting horizon — cards that will fade if
 *                   never reviewed again.
 *
 * The control is an accessible HTML range input with a bespoke visual
 * track layered on top. Keyboard users can use arrow keys; screen readers
 * announce the current date and counts via an aria-live region.
 */

import { useState, useId, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { CollectionTimeline } from "@/lib/timeline/reconstruct";
import { snapshotAtPosition } from "@/lib/timeline/reconstruct";
import { chartTickText } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

// directionLabel is computed inside the component using tWidget so it can localise.

/**
 * Colour swatch for the direction pill.
 */
function directionClass(position: number): string {
  if (position < -0.01)
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  if (position > 0.01)
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
}

// Number of discrete steps in the range input. More steps = finer drag resolution.
const RANGE_STEPS = 400;
// The slider value at the centre represents position 0 (now).
const RANGE_CENTRE = RANGE_STEPS / 2; // 200

/** Map slider integer value (0..RANGE_STEPS) to position (-1..1). */
function sliderToPosition(v: number): number {
  return (v - RANGE_CENTRE) / RANGE_CENTRE;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CountPill({
  count,
  label,
  colour,
}: {
  count: number;
  label: string;
  colour: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-2xl font-bold tabular-nums ${colour}`}>
        {count.toLocaleString("en-GB")}
      </span>
      <span className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
    </div>
  );
}

function ProgressBar({
  value,
  max,
  colourClass,
  label,
}: {
  value: number;
  max: number;
  colourClass: string;
  label: string;
}) {
  const p = pct(value, max);
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
    >
      <div
        className={`h-full rounded-full transition-all duration-200 ${colourClass}`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — shown when no grade log data exists yet
// ---------------------------------------------------------------------------

function EmptyState() {
  const tWidget = useTranslations("journey.collectionTimelineWidget");
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-6 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {tWidget("noHistoryYet")}
      </p>
      <p className="max-w-xs text-xs text-zinc-400 dark:text-zinc-500">
        {tWidget("noHistoryBody")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollectionTimeline
// ---------------------------------------------------------------------------

export type CollectionTimelineProps = {
  timeline: CollectionTimeline;
};

export function CollectionTimeline({ timeline }: CollectionTimelineProps) {
  const tWidget = useTranslations("journey.collectionTimelineWidget");
  const sliderId = useId();
  const liveId = useId();

  // Start at "now" (position 0, slider centre).
  const [sliderValue, setSliderValue] = useState(RANGE_CENTRE);

  const position = sliderToPosition(sliderValue);
  const snapshot = useMemo(
    () => snapshotAtPosition(timeline, position),
    [timeline, position],
  );

  const { totalSpecies } = timeline;
  const isFuture = position > 0.01;
  const isPast = position < -0.01;

  /** Locale-aware direction label. */
  const directionLabel = isPast
    ? tWidget("directionPast")
    : isFuture
      ? tWidget("directionFuture")
      : tWidget("directionNow");

  // Static two-colour track: blue left half (past), amber right half (future).
  // The thumb's position on the track communicates which direction the user
  // has explored; a separate centre notch marks the "now" anchor.
  const trackGradient =
    "linear-gradient(to right, #3b82f6 0%, #3b82f6 50%, #f59e0b 50%, #f59e0b 100%)";

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSliderValue(Number(e.target.value));
    },
    [],
  );

  // Snap back to "now" (centre) when user double-taps/double-clicks the thumb.
  const handleDoubleClick = useCallback(() => {
    setSliderValue(RANGE_CENTRE);
  }, []);

  // If neither past nor future data exists, show an empty state.
  const hasData = timeline.past.length > 0 || timeline.future.length > 0;
  if (!hasData) {
    return (
      <section aria-labelledby="timeline-heading">
        <h2
          id="timeline-heading"
          className="mb-4 text-lg font-semibold text-foreground"
        >
          {tWidget("heading")}
        </h2>
        <EmptyState />
      </section>
    );
  }

  const introducedPct = pct(snapshot.introduced, totalSpecies);
  const masteredPct = pct(snapshot.mastered, totalSpecies);

  // Accessible announcement for screen readers.
  const announcementText = isFuture
    ? tWidget("announcementRetained", {
        date: formatDate(snapshot.atMs),
        mastered: snapshot.mastered,
        pct: masteredPct,
        total: totalSpecies,
      })
    : tWidget("announcementBuilt", {
        date: formatDate(snapshot.atMs),
        introduced: snapshot.introduced,
        mastered: snapshot.mastered,
      });

  return (
    <section aria-labelledby="timeline-heading">
      <h2
        id="timeline-heading"
        className="mb-4 text-lg font-semibold text-foreground"
      >
        {tWidget("heading")}
      </h2>

      <div className="rounded-xl border border-zinc-200 bg-background px-5 py-5 dark:border-zinc-800">
        {/* Direction pill + date */}
        <div className="mb-4 flex items-center justify-between">
          <span
            data-testid="timeline-direction-pill"
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${directionClass(position)}`}
          >
            {directionLabel}
          </span>
          <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
            {formatDate(snapshot.atMs)}
          </span>
        </div>

        {/* Count pills */}
        <div
          className="mb-5 flex justify-around"
          aria-hidden="true"
        >
          {isFuture ? (
            <>
              <CountPill
                count={snapshot.mastered}
                label={tWidget("stillRetained")}
                colour="text-amber-500 dark:text-amber-400"
              />
              <CountPill
                count={totalSpecies - snapshot.mastered}
                label={tWidget("forgotten")}
                colour={chartTickText}
              />
            </>
          ) : (
            <>
              <CountPill
                count={snapshot.introduced}
                label={tWidget("introduced")}
                colour="text-blue-600 dark:text-blue-400"
              />
              <CountPill
                count={snapshot.mastered}
                label={tWidget("mastered")}
                colour="text-emerald-600 dark:text-emerald-400"
              />
            </>
          )}
        </div>

        {/* Progress bars */}
        {!isFuture && (
          <div className="mb-5 flex flex-col gap-2" aria-hidden="true">
            <ProgressBar
              value={snapshot.introduced}
              max={totalSpecies}
              colourClass="bg-blue-500"
              label={`Introduced: ${introducedPct}%`}
            />
            <ProgressBar
              value={snapshot.mastered}
              max={totalSpecies}
              colourClass="bg-emerald-500"
              label={`Mastered: ${masteredPct}%`}
            />
          </div>
        )}
        {isFuture && (
          <div className="mb-5" aria-hidden="true">
            <ProgressBar
              value={snapshot.mastered}
              max={totalSpecies}
              colourClass="bg-amber-400"
              label={`Retained: ${masteredPct}%`}
            />
          </div>
        )}

        {/* Axis labels */}
        <div
          className="mb-1 flex justify-between text-xs text-zinc-400 dark:text-zinc-500"
          aria-hidden="true"
        >
          <span>{tWidget("past")}</span>
          <span>{tWidget("now")}</span>
          <span>{tWidget("future")}</span>
        </div>

        {/* Scrubber */}
        <div className="relative">
          {/* Visual track — a coloured gradient bar behind the thumb */}
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full"
            style={{ background: trackGradient }}
            aria-hidden="true"
          />
          {/* Centre notch */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400"
            aria-hidden="true"
          />
          {/* The actual range input — transparent except the thumb */}
          <input
            id={sliderId}
            type="range"
            min={0}
            max={RANGE_STEPS}
            step={1}
            value={sliderValue}
            onChange={handleChange}
            onDoubleClick={handleDoubleClick}
            aria-label={tWidget("scrubberAriaLabel")}
            aria-describedby={liveId}
            aria-valuetext={announcementText}
            className={[
              "relative w-full cursor-pointer appearance-none bg-transparent",
              // Thumb styles via Tailwind arbitrary variants for cross-browser.
              "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
              "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
              "[&::-webkit-slider-thumb]:shadow-md",
              isFuture
                ? "[&::-webkit-slider-thumb]:bg-amber-400"
                : isPast
                  ? "[&::-webkit-slider-thumb]:bg-blue-500"
                  : "[&::-webkit-slider-thumb]:bg-emerald-500",
              "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5",
              "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2",
              "[&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md",
              isFuture
                ? "[&::-moz-range-thumb]:bg-amber-400"
                : isPast
                  ? "[&::-moz-range-thumb]:bg-blue-500"
                  : "[&::-moz-range-thumb]:bg-emerald-500",
              // Hide the default track (we paint our own).
              "[&::-webkit-slider-runnable-track]:appearance-none [&::-webkit-slider-runnable-track]:bg-transparent",
              "[&::-moz-range-track]:bg-transparent",
              // Focus ring.
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              isFuture
                ? "focus-visible:ring-amber-400"
                : isPast
                  ? "focus-visible:ring-blue-500"
                  : "focus-visible:ring-emerald-500",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="timeline-scrubber"
          />
        </div>

        {/* Hint text + reset button */}
        <div className="mt-2 flex items-center justify-center gap-3">
          <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
            {position === 0
              ? tWidget("dragHintNow")
              : isFuture
                ? tWidget("dragHintFuture")
                : tWidget("dragHintPast")}
          </p>
          {position !== 0 && (
            <button
              type="button"
              onClick={() => setSliderValue(RANGE_CENTRE)}
              className="shrink-0 rounded px-2 py-0.5 text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
              aria-label={tWidget("resetAriaLabel")}
            >
              {tWidget("reset")}
            </button>
          )}
        </div>

        {/* Screen-reader live region */}
        <div
          id={liveId}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announcementText}
        </div>
      </div>
    </section>
  );
}
