"use client";

import { useEffect, useId, useRef, useState } from "react";

const STORAGE_PREFIX = "poke-memory:settings-section:";

function readOpenState(sectionId: string): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${sectionId}`);
  if (raw === null) return false;
  return raw === "1";
}

function writeOpenState(sectionId: string, open: boolean): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${sectionId}`, open ? "1" : "0");
  } catch {
    // Silently ignore — localStorage might be unavailable in private browsing.
  }
}

type Props = {
  /** Stable identifier used as the section element id and the localStorage key. */
  sectionId: string;
  /** Heading text shown as the disclosure toggle. */
  heading: string;
  /** Optional class names applied to the outer section element. */
  className?: string;
  /** Section content — rendered when expanded. */
  children: React.ReactNode;
  /**
   * When true, force-expand this section AND persist the open state to
   * localStorage. Used for hash-based deep-linking: when the URL hash targets
   * this section's id the page passes `forceOpen` so it expands, scrolls into
   * view, and stays open on the next visit.
   */
  forceOpen?: boolean;
  /**
   * When true, force-expand this section WITHOUT writing to localStorage.
   * Used for search-driven expansion: sections are shown open while a query
   * is active but revert to their persisted state once the query is cleared.
   */
  transientOpen?: boolean;
};

export function CollapsibleSection({
  sectionId,
  heading,
  className,
  children,
  forceOpen = false,
  transientOpen = false,
}: Props) {
  // Initialise from localStorage so there is no layout flash on re-mount.
  const [open, setOpen] = useState<boolean>(() => readOpenState(sectionId));
  const sectionRef = useRef<HTMLElement>(null);
  // Stable id wires aria-controls on the button to the content region.
  const panelId = useId();

  // Honour forceOpen (e.g. hash deep-link). Persists to localStorage so the
  // section stays open on the next visit. Only runs when forceOpen flips to
  // true — does not collapse when it flips back to false.
  useEffect(() => {
    if (!forceOpen) return;
    setOpen(true);
    writeOpenState(sectionId, true);
  }, [forceOpen, sectionId]);

  // Scroll into view when the section is force-opened via a hash link.
  // Guard against environments (tests) that don't implement scrollIntoView.
  useEffect(() => {
    if (!forceOpen || !sectionRef.current) return;
    sectionRef.current.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [forceOpen]);

  // Derive the effective open state: transientOpen overrides the persisted
  // state for search-driven expansion without writing to localStorage.
  const effectiveOpen = open || transientOpen;

  function toggle() {
    const next = !open;
    setOpen(next);
    writeOpenState(sectionId, next);
  }

  return (
    <section
      id={sectionId}
      ref={sectionRef}
      className={[
        "rounded-xl border border-zinc-200 px-5 py-4 dark:border-zinc-800",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/*
        The heading wraps the button so the section heading is discoverable
        via assistive-technology heading navigation whilst also acting as an
        accessible disclosure control.
      */}
      <h2
        id={`${sectionId}-heading`}
        className="m-0"
      >
        <button
          type="button"
          aria-expanded={effectiveOpen}
          aria-controls={panelId}
          onClick={toggle}
          className={[
            "flex w-full items-center justify-between gap-4 text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded",
          ].join(" ")}
        >
          <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {heading}
          </span>
          <ChevronIcon open={effectiveOpen} />
        </button>
      </h2>

      {/* Collapsible panel -------------------------------------------------- */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={`${sectionId}-heading`}
        hidden={!effectiveOpen}
        className="mt-4 flex flex-col gap-4"
      >
        {children}
      </div>
    </section>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={[
        "h-4 w-4 shrink-0 transition-transform duration-200 text-zinc-400 dark:text-zinc-500",
        open ? "rotate-180" : "rotate-0",
      ].join(" ")}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
