"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { formatDate, type DateFormat } from "@/lib/utils/format-date";
import { cardPanel } from "@/lib/utils/class-names";
import type { DueForecastDay } from "@/lib/stats/derive";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ForecastTooltip = {
  /** Index of the bar with the open tooltip. */
  idx: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a YYYY-MM-DD date for the due-forecast tooltip / aria-label.
 * Uses en-GB English month/weekday names to avoid locale-leaking French or
 * German names on non-English browser locales. fmt and tz come from user
 * settings; they default to dmy / UTC when not yet set.
 */
function formatForecastDate(
  iso: string,
  fmt: DateFormat = "dmy",
  tz = "UTC",
): string {
  return formatDate(iso, fmt, tz);
}

/**
 * Returns Tailwind classes for horizontal tooltip positioning.
 *
 * Each bar is ~1/14th of the container width (roughly 26 px on iPhone 14).
 * Centring the tooltip over the bar with -translate-x-1/2 causes the
 * tooltip to bleed off the panel edges for the first and last few bars.
 *
 * Rule (14 bars, 0-indexed):
 *   bars 0-2   → anchor to left edge  (left-0, no translate)
 *   bars 11-13 → anchor to right edge (right-0, no translate, left-auto)
 *   bars 3-10  → centre               (left-1/2, -translate-x-1/2)
 */
function tooltipPositionClasses(idx: number): string {
  if (idx <= 2) {
    return "left-0";
  }
  if (idx >= 11) {
    return "right-0 left-auto";
  }
  return "left-1/2 -translate-x-1/2";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface DueForecastProps {
  forecast: readonly DueForecastDay[];
  fmt?: DateFormat;
  tz?: string;
}

export default function DueForecast({
  forecast,
  fmt = "dmy",
  tz = "UTC",
}: DueForecastProps) {
  const t = useTranslations("stats");
  const max = forecast.reduce((m, d) => (d.count > m ? d.count : m), 0);
  const total = forecast.reduce((s, d) => s + d.count, 0);

  // Tooltip state: the index of the bar whose popup is open, or null.
  const [openTooltip, setOpenTooltip] = useState<ForecastTooltip | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tracks whether the last interaction with the active bar was a click/tap
  // or a mouse hover. On hybrid touch+mouse devices (e.g. Surface, iPad with
  // keyboard), (hover: hover) returns true but a tap also fires synthetic
  // mouse events. The mouseleave handler should only close the tooltip when it
  // was opened via hover, not via a deliberate tap.
  const lastInteraction = useRef<"click" | "hover" | null>(null);

  // On mobile WebKit (iOS Safari), a tap fires synthetic mouseenter before the
  // click event. This ref records the index that onMouseEnter just opened so
  // that handleBarClick can detect "mouseenter already opened this bar" and
  // avoid toggling the tooltip closed again in the same gesture.
  const hoverOpenedIdx = useRef<number | null>(null);

  // Close the popup when the user clicks/taps outside the chart container.
  useEffect(() => {
    if (openTooltip === null) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpenTooltip(null);
        lastInteraction.current = null;
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [openTooltip]);

  function handleBarClick(idx: number) {
    // On mobile WebKit, a tap fires synthetic mouseenter before onClick.
    // hoverOpenedIdx records the bar index that onMouseEnter just opened.
    // When click fires for the same bar, the tooltip is already open from
    // hover — skip the toggle so we don't immediately close it again.
    if (hoverOpenedIdx.current === idx) {
      hoverOpenedIdx.current = null;
      lastInteraction.current = "click";
      return;
    }
    hoverOpenedIdx.current = null;
    lastInteraction.current = "click";
    setOpenTooltip((prev) => (prev?.idx === idx ? null : { idx }));
  }

  function handleBarKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBarClick(idx);
    } else if (e.key === "Escape") {
      setOpenTooltip(null);
      lastInteraction.current = null;
    }
  }

  return (
    <section aria-labelledby="due-heading">
      <h2
        id="due-heading"
        className="mb-3 text-base font-semibold text-foreground"
      >
        Due forecast
      </h2>
      <div className={cardPanel}>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
          {t("cardsOverNextDays", { count: total })}
        </p>
        {/* ref on this container so outside-click detection has a boundary. */}
        <div ref={containerRef}>
          <div
            className="grid h-24 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1"
            role="list"
            aria-label="14-day due forecast"
          >
            {forecast.map((day, idx) => {
              const heightPct = max === 0 ? 0 : (day.count / max) * 100;
              const isToday = idx === 0;
              const isOpen = openTooltip?.idx === idx;
              const tooltipId = `due-forecast-tooltip-${idx}`;
              const label = `${formatForecastDate(day.date, fmt, tz)}: ${t("cardCount", { count: day.count })}`;
              return (
                <div
                  key={day.date}
                  role="listitem"
                  className="group relative flex h-full flex-col justify-end"
                >
                  {/* Popup tooltip — shown on tap (mobile) or hover (desktop).
                      Positioned with horizontal clamping so the tooltip never
                      bleeds off the panel edge on narrow viewports. */}
                  {isOpen && (
                    <div
                      role="tooltip"
                      id={tooltipId}
                      className={[
                        "pointer-events-none absolute bottom-full z-10 mb-2",
                        tooltipPositionClasses(idx),
                        "whitespace-nowrap rounded-md px-2 py-1 text-xs shadow-md",
                        "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
                      ].join(" ")}
                    >
                      <span className="block font-medium">
                        {formatForecastDate(day.date, fmt, tz)}
                      </span>
                      <span className="block tabular-nums">
                        {t("cardCount", { count: day.count })}
                      </span>
                    </div>
                  )}
                  {/*
                    Each bar is a <button> so it is natively focusable and
                    activatable via Enter/Space. The aria-label carries the
                    full date + count for screen readers; aria-describedby
                    references the tooltip when it is open, giving assistive
                    technology access to the supplementary popup content.
                    aria-expanded is intentionally omitted — it signals an
                    owned expandable region (accordion pattern), which does
                    not apply here; the tooltip is a sibling description, not
                    a controlled child.
                  */}
                  <button
                    type="button"
                    aria-label={label}
                    aria-describedby={isOpen ? tooltipId : undefined}
                    onClick={() => handleBarClick(idx)}
                    onKeyDown={(e) => handleBarKeyDown(e, idx)}
                    onMouseEnter={() => {
                      lastInteraction.current = "hover";
                      hoverOpenedIdx.current = idx;
                      setOpenTooltip({ idx });
                    }}
                    onMouseLeave={() => {
                      // Only dismiss on mouseleave when the tooltip was opened
                      // by hovering — not by a tap. On hybrid touch+mouse
                      // devices, tapping fires synthetic mouse events that
                      // would otherwise immediately close the popup.
                      hoverOpenedIdx.current = null;
                      if (lastInteraction.current === "hover") {
                        setOpenTooltip(null);
                        lastInteraction.current = null;
                      }
                    }}
                    className={[
                      "h-full w-full flex flex-col justify-end",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                      isToday
                        ? "focus-visible:ring-rose-500"
                        : "focus-visible:ring-emerald-500",
                    ].join(" ")}
                  >
                    <div
                      className={
                        isToday
                          ? "rounded-sm bg-rose-500"
                          : "rounded-sm bg-emerald-500/60 group-hover:bg-emerald-500"
                      }
                      style={{
                        height:
                          heightPct === 0 ? "2px" : `${Math.max(heightPct, 6)}%`,
                      }}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
            {forecast.map((day, idx) => (
              <span key={day.date} className="text-center">
                {idx === 0 ? "Today" : new Date(day.date).getDate()}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
