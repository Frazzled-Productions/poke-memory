"use client";

/**
 * InfoButton — a small accessible disclosure button (circle-i icon) that
 * toggles an explanatory panel open/closed.
 *
 * Follows WAI-ARIA disclosure-button pattern:
 *   - role="button" with aria-label + aria-expanded reflects open/closed state.
 *   - Panel is conditionally rendered (not CSS-hidden) so screen readers only
 *     see the content when it is open.
 *   - Keyboard: Tab to reach, Enter/Space to toggle, Escape to close.
 *   - Outside-click closes the panel.
 *
 * Usage:
 *   <InfoButton
 *     ariaLabel="Sort explanation"
 *     panelContent={<p>...</p>}
 *     panelId="sort-info"
 *   />
 *
 * The `panelId` must be unique per page so aria-controls is meaningful.
 */

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InfoButtonProps = {
  /** Accessible label for the toggle button (describes what the panel explains). */
  ariaLabel: string;
  /** The explanatory content rendered inside the panel when open. */
  panelContent: ReactNode;
  /** Unique id for the panel element (used by aria-controls on the button). */
  panelId: string;
  /** Extra classes on the panel container (e.g. for positioning). */
  panelClassName?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InfoButton({
  ariaLabel,
  panelContent,
  panelId,
  panelClassName,
}: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click.
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (
      containerRef.current !== null &&
      !containerRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
    } else {
      document.removeEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open, handleOutsideClick]);

  // Close on Escape.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open],
  );

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1 transition-colors"
      >
        {/* Circle-i SVG — aria-hidden because the button carries the aria-label. */}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className="h-3.5 w-3.5"
        >
          <circle
            cx="8"
            cy="8"
            r="7"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <line
            x1="8"
            y1="7"
            x2="8"
            y2="11.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="8" cy="4.5" r="0.75" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          className={[
            "absolute z-10 mt-1 w-72 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
            panelClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {panelContent}
        </div>
      )}
    </div>
  );
}
