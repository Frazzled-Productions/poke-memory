"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import Image from "next/image";
import type { NameReviewCard } from "@/lib/review/session";
import { ArrivalSparkle } from "./ArrivalSparkle";
import styles from "./Pasture.module.css";
import { PASTURE_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { mutedTextXs } from "@/lib/utils/class-names";
import { formatDate } from "@/lib/utils/format-date";

type Props = {
  card: NameReviewCard;
  onMarkSeen: (cardId: number) => void;
};

const LONG_PRESS_MS = 500;
const HOP_DURATION_MS = 600;

/**
 * Individual Pokémon sprite rendered in a pasture zone.
 *
 * - Idle bob animation with a per-instance randomised phase offset (useRef so
 *   the value is stable across renders without causing hydration mismatch).
 * - Tap: plays cry + applies hop animation. Clears the arrival sparkle on
 *   first tap if seenInPasture is false.
 * - Long-press (500 ms): opens a detail popover with name, mastery date, and
 *   scheduledDays. Tap-outside or Escape dismisses.
 */
export function PasturePokemon({ card, onMarkSeen }: Props) {
  // Stable per-sprite animation delay so sprites bob asynchronously.
  // No hydration mismatch because PasturePage returns null until `loaded=true`
  // (set in a useEffect), so this component never renders on the server.
  const delayRef = useRef<number | null>(null);
  if (delayRef.current === null) {
    delayRef.current = Math.random() * 2;
  }

  const [isHopping, setIsHopping] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set true when the long-press timer fires; consumed by the click that
  // follows pointerUp so a long-press doesn't also trigger cry/hop.
  const longPressFiredRef = useRef(false);
  const hopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Clear any pending hop-release on unmount to avoid a setState on an
  // unmounted component if the user navigates mid-animation.
  useEffect(() => {
    return () => {
      if (hopTimerRef.current !== null) clearTimeout(hopTimerRef.current);
    };
  }, []);

  const playCry = useCallback(() => {
    try {
      const audio = new Audio(card.cryUrl ?? `/cries/${card.id}.ogg`);
      audio.play().catch(() => {
        // Ignore — mobile Safari may block without user gesture in some cases.
      });
    } catch {
      // Ignore audio errors entirely.
    }
  }, [card.cryUrl, card.id]);

  const triggerHop = useCallback(() => {
    setIsHopping(true);
    if (hopTimerRef.current !== null) clearTimeout(hopTimerRef.current);
    hopTimerRef.current = setTimeout(() => {
      hopTimerRef.current = null;
      setIsHopping(false);
    }, HOP_DURATION_MS);
  }, []);

  const handleClick = useCallback(() => {
    // The click that follows a long-press should not also play the cry — the
    // user's intent was the popover, not a tap. Consume the flag and bail.
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }

    // Tap-on-self while the popover is open: dismiss it and let the tap fall
    // through to the normal cry/hop interaction. Without this branch the
    // sprite is a dead zone while its own popover is visible.
    if (showPopover) {
      setShowPopover(false);
    }

    playCry();
    triggerHop();

    if (!card.state.seenInPasture) {
      onMarkSeen(card.id);
    }
  }, [playCry, triggerHop, card.state.seenInPasture, card.id, onMarkSeen, showPopover]);

  const handlePointerDown = useCallback(() => {
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredRef.current = true;
      setShowPopover(true);
    }, LONG_PRESS_MS);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Dismiss popover on Escape
  useEffect(() => {
    if (!showPopover) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPopover(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [showPopover]);

  // Dismiss popover on click-outside
  useEffect(() => {
    if (!showPopover) return;
    function handleOutsideClick(e: MouseEvent) {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setShowPopover(false);
      }
    }
    // Delay adding the listener so the triggering pointerdown doesn't
    // immediately dismiss via the same event path.
    const timerId = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
    }, 0);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [showPopover]);

  // Routes through formatDate (lib/utils/format-date.ts) so raw
  // toLocaleDateString calls are banned from components (#1456 lint rule).
  // "dmy-year" gives en-GB ordering ("18 May 2026") with year included.
  // "UTC" timezone: firstSeen is a "YYYY-MM-DD" string; formatDate parses it
  // at noon UTC so no DST shift occurs.
  const firstSeenLabel = card.state.firstSeen
    ? formatDate(card.state.firstSeen, "dmy-year", "UTC")
    : "Unknown";

  const spriteClass = [
    isHopping ? styles.spriteHop : styles.spriteBob,
  ].join(" ");

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        aria-label={`${card.name}${!card.state.seenInPasture ? " (new arrival)" : ""}`}
        className="relative flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 rounded"
        style={{ touchAction: "manipulation" }}
      >
        <Image
          src={card.spriteUrl}
          alt={card.name}
          width={PASTURE_SPRITE_SIZE}
          height={PASTURE_SPRITE_SIZE}
          className={[
            "h-14 w-14 object-contain select-none",
            spriteClass,
          ].join(" ")}
          style={{ animationDelay: `${delayRef.current}s` }}
          draggable={false}
        />
        {!card.state.seenInPasture && <ArrivalSparkle />}
      </button>

      {showPopover && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={`${card.name} details`}
          className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 w-44 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <p className="text-center text-sm font-semibold text-foreground">
            {card.name}
          </p>
          <dl className={`mt-1.5 space-y-0.5 ${mutedTextXs}`}>
            <div className="flex justify-between">
              <dt>First seen</dt>
              <dd>{firstSeenLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Interval</dt>
              <dd>{card.state.scheduledDays}d</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => setShowPopover(false)}
            className="mt-2 w-full rounded-md bg-zinc-100 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            aria-label="Close details"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
