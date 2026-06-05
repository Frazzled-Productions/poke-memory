"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { QueueCounterRow } from "@/components/review/QueueCounterRow";

// ---------------------------------------------------------------------------
// Undo button - extracted so each variant branch does not repeat the JSX
// ---------------------------------------------------------------------------

interface UndoButtonProps {
  onClick: () => void;
  /** Extra classes on the root element (e.g. "flex-none" for the flex variants). */
  className?: string;
}

export function UndoButton({ onClick, className = "" }: UndoButtonProps) {
  const t = useTranslations("practice");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${className} min-h-[36px] mb-3 sm:mb-0 rounded-lg border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`}
      aria-label={t("undoLastGradeAriaLabel")}
    >
      {t("undoLastGrade")}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ReviewCardLayout
// ---------------------------------------------------------------------------

export interface ReviewCardLayoutProps {
  /**
   * Outer layout variant.
   *
   * - "flip" - name / evolution / reverse-evolution / cry cards.
   *                Full-height flex column, gap-2 sm:gap-8, card region uses
   *                `overflow-hidden`.
   * - "reverse" - SpritePicker (multiple-choice). Same full-height flex column
   *                but gap-2 sm:gap-4 and card region uses `overflow-y-auto` so
   *                very short viewports (e.g. iPhone SE) can scroll the tiles.
   * - "countdown" - No card; just queue counter + undo + countdown content.
   *                  Plain centred column, gap-6, no flex-1.
   */
  variant: "flip" | "reverse" | "countdown";

  /**
   * Top-of-card chrome: storage / grade error banners, SpritePreloader, and
   * ScopeControl. Omitted by the countdown branch, which has no active card.
   */
  topChrome?: ReactNode;

  /**
   * QueueStateBadge for the current card. Omitted by the countdown branch.
   */
  queueStateBadge?: ReactNode;

  /**
   * The primary card or countdown content. For flip/reverse variants this
   * receives the card body (PokemonCard, EvolutionCard, SpritePicker, or the
   * cry play button). For the countdown variant this receives CountdownScreen.
   */
  cardRegion: ReactNode;

  /**
   * Content to render between the card region and the controls slot.
   * Used by the reverse branch to position the audio onboarding hint
   * outside the `overflow-y-auto` card region but before the bottom chrome.
   */
  belowCard?: ReactNode;

  /**
   * Reveal / grade controls rendered below the card region. Omitted by the
   * countdown branch (no interaction needed there) and by the reverse branch
   * (SpritePicker handles its own grading inline).
   */
  controls?: ReactNode;

  /**
   * Keyboard shortcuts overlay (KeyboardShortcutsOverlay). Rendered outside
   * the revealed/unrevealed conditional so pressing `?` works at any point.
   * Omitted by the countdown branch.
   */
  keyboardShortcutsOverlay?: ReactNode;

  /**
   * True when this card is mid-learning-step but falls outside the active
   * practice scope. Renders the OutOfScopeHint caption.
   */
  showOutOfScopeHint: boolean;

  /** New / learning / review queue counts for QueueCounterRow. */
  queueCounts: { newCount: number; learningCount: number; reviewCount: number };

  /** Non-null when a grade has been committed and undo is available. */
  hasUndoSnapshot: boolean;
  onUndo: () => void;

  /**
   * Bottom stats panel. Each variant is responsible for wrapping its content
   * with the correct `hidden sm:*` visibility class, since the display value
   * differs (cry: `sm:block`; reverse/default: `sm:flex sm:flex-col`).
   * Pass `null` or omit to render nothing (countdown has no stats).
   */
  statsPanel?: ReactNode;

  /** BadgeToast slot rendered at the end of the tree. */
  badgeToastSlot?: ReactNode;
}

// Subtle caption shown when a card is mid-learning-step but falls outside
// the active practice scope. Scheduling continues so FSRS state is not
// corrupted; this hint explains the visible-but-out-of-scope card.
function OutOfScopeHint() {
  const t = useTranslations("practice");
  return (
    <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center italic">
      {t("outOfScopeHint")}
    </p>
  );
}

export function ReviewCardLayout({
  variant,
  topChrome,
  queueStateBadge,
  cardRegion,
  belowCard,
  controls,
  keyboardShortcutsOverlay,
  showOutOfScopeHint,
  queueCounts,
  hasUndoSnapshot,
  onUndo,
  statsPanel,
  badgeToastSlot,
}: ReviewCardLayoutProps) {
  const { newCount, learningCount, reviewCount } = queueCounts;

  // Countdown has a simpler, non-stretching layout.
  if (variant === "countdown") {
    return (
      <div className="flex flex-col items-center gap-6">
        <QueueCounterRow
          newCount={newCount}
          learningCount={learningCount}
          reviewCount={reviewCount}
        />
        {hasUndoSnapshot && <UndoButton onClick={onUndo} />}
        {cardRegion}
      </div>
    );
  }

  // Outer gap differs between flip and reverse variants.
  const outerGap = variant === "reverse" ? "gap-2 sm:gap-4" : "gap-2 sm:gap-8";

  // Card region overflow differs: reverse uses overflow-y-auto so very short
  // viewports (e.g. iPhone SE) can scroll the picker tiles. Flip cards use
  // overflow-hidden to prevent the card shadow from bleeding.
  const cardRegionOverflow =
    variant === "reverse" ? "overflow-y-auto" : "overflow-hidden";

  return (
    /* Height-filling flex column - grade buttons stay on screen without
       scrolling on mobile (#1087). flex-1 min-h-0 propagates from the page
       height chain. */
    <div
      className={`flex flex-col flex-1 min-h-0 w-full items-center ${outerGap}`}
    >
      {/* Banners, SpritePreloader, ScopeControl: flex-none so they do not
          consume the stretch height. */}
      {topChrome !== undefined && (
        <div className="flex-none w-full">{topChrome}</div>
      )}

      {/* QueueStateBadge */}
      {queueStateBadge !== undefined && (
        <div className="flex-none">{queueStateBadge}</div>
      )}

      {/* Card region: flex-1 min-h-0 absorbs leftover height; items-center
          keeps the card vertically balanced. */}
      <div
        className={`flex flex-1 min-h-0 w-full items-center justify-center ${cardRegionOverflow}`}
      >
        {cardRegion}
      </div>

      {/* Content between card region and controls (e.g. audio hint for
          reverse cards, which sits outside the overflow-y-auto card region). */}
      {belowCard !== undefined && belowCard}

      {/* Grade / reveal controls */}
      {controls !== undefined && (
        <div className="flex-none w-full flex flex-col items-center gap-2">
          {controls}
        </div>
      )}

      {/* Keyboard shortcuts overlay - rendered outside the
          revealed/unrevealed conditional so pressing `?` works at any
          point in the review cycle. */}
      {keyboardShortcutsOverlay}

      {/* Out-of-scope hint */}
      {showOutOfScopeHint && (
        <div className="flex-none">
          <OutOfScopeHint />
        </div>
      )}

      {/* Queue counters */}
      <div className="flex-none">
        <QueueCounterRow
          newCount={newCount}
          learningCount={learningCount}
          reviewCount={reviewCount}
        />
      </div>

      {/* Undo button */}
      {hasUndoSnapshot && (
        <UndoButton className="flex-none" onClick={onUndo} />
      )}

      {/* Session stats: hidden on mobile to keep grade buttons in view
          (#1087). Each variant supplies a pre-wrapped element that carries
          the correct `hidden sm:*` class for its display model. */}
      {statsPanel !== undefined && statsPanel !== null && statsPanel}

      {/* Badge toast */}
      {badgeToastSlot}
    </div>
  );
}
