"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { DirectionBadge } from "@/components/review/DirectionBadge";
import {
  gradeTypedAnswerLocale,
  type TypedEntryLocale,
  type TypedEntryStrictness,
} from "@/lib/srs/typedEntryGradeLocale";
import {
  loadLocaleNames,
  getLocaleName,
  getTransliteration,
} from "@/lib/pokemon/localeNames";
import { PRACTICE_SPRITE_SIZE } from "@/lib/sprites/sizes";
import { mutedText } from "@/lib/utils/class-names";
import type { Grade } from "@/lib/review/session";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";

// Feedback is held visible for this long before calling onGrade so the parent
// can advance to the next card. 1.5 s gives enough time for Playwright and
// sighted users to read the result; wrong answers use the same delay.
const FEEDBACK_HOLD_MS = 1500;

type Props = {
  spriteUrl: string;
  canonicalName: string;
  /** Pokémon id - passed through to the Image alt text and future TTS. */
  id?: number | null;
  onGrade: (grade: Grade) => void;
  /** While true the submit button is disabled (grade in flight). */
  grading?: boolean;
  /**
   * The card's learning locale (#1576). Non-English cards are graded against
   * the native-script name for this locale (plus its romanisation in lenient
   * mode) via `gradeTypedAnswerLocale`. Defaults to `"en"`, which delegates
   * unchanged to the original English grader.
   */
  locale?: TypedEntryLocale;
  /**
   * Grading strictness for non-English locales (#1576): `"lenient"` also
   * accepts the pre-baked romanisation; `"strict"` is native script only.
   * Ignored for `locale === "en"`.
   */
  strictness?: TypedEntryStrictness;
};

/**
 * Typed-entry variant of the name card (#1251).
 *
 * Renders the sprite (prompt) + a text input + Submit + "I don't know".
 * The user types the name; the grade is computed automatically:
 *   - Exact match (case-insensitive, punctuation-stripped) → Good (4)
 *   - Off by 1–2 chars → Hard (2) - feedback shown before advancing
 *   - Off by > 2 or empty → Again (1) - correct answer revealed
 *   - "I don't know" click → Again (1) - correct answer revealed
 *
 * This is a UI component owned by ui-coder by convention, but lives in
 * components/review/ alongside the existing card components. The grading
 * logic itself is a pure lib function (lib/srs/typedEntryGrade.ts).
 *
 * The component calls `onGrade` once and then becomes "submitted" - further
 * input is ignored while the grade is in flight. The parent (ReviewSession)
 * is responsible for advancing to the next card.
 *
 * For English cards the revealed answer text uses the locale-resolved name
 * from `useLocalePokemonName` so it updates when `pokemonNameLocale` changes
 * (#1260 followup) and grading compares against `canonicalName`.
 *
 * For non-English cards (#1576) grading and reveal both follow the card's
 * LEARNING locale (`locale` prop), not the display axis: the input is graded
 * against the native-script name (plus the pre-baked romanisation in lenient
 * mode) via `gradeTypedAnswerLocale`, and the reveal always shows the native
 * script AND the romanisation so the accepted answer set is never hidden.
 * The sidecar lookup is awaited at submit time, so grading never races the
 * sidecar fetch. Submit stays disabled mid-IME-composition
 * (compositionstart/compositionend) so confirming a kana/hanzi candidate
 * with Enter never submits the form.
 */
export function TypedEntryNameCard({
  spriteUrl,
  canonicalName,
  id,
  onGrade,
  grading = false,
  locale = "en",
  strictness = "lenient",
}: Props) {
  const t = useTranslations("review");
  const [inputValue, setInputValue] = useState("");
  // "submitted" tracks whether the user has pressed Submit or I don't know.
  // Once submitted we reveal the feedback so it is visible before the parent
  // advances to the next card.
  const [submitted, setSubmitted] = useState(false);
  const [feedbackGrade, setFeedbackGrade] = useState<Grade | null>(null);
  // True while an IME composition session is active on the input (#1576).
  const [composing, setComposing] = useState(false);
  // The locale answer captured at submit time, for the non-English reveal.
  const [revealAnswer, setRevealAnswer] = useState<{
    nativeName: string;
    transliteration: string | null;
  } | null>(null);
  // Tracks whether onGrade has already been called so we never double-fire.
  const gradedRef = useRef(false);

  // Locale-resolved name for the revealed-answer display on ENGLISH cards
  // (follows the pokemonNameLocale display axis, #1260 followup). Non-English
  // cards reveal via `revealAnswer` (learning-locale axis) instead.
  const { name: localeDisplayName } = useLocalePokemonName(id ?? undefined, canonicalName);

  async function submit(skipAnswer: boolean) {
    if (submitted || grading || gradedRef.current) return;
    // Guard immediately - the sidecar await below yields, and a double-click
    // in that window must not double-fire.
    gradedRef.current = true;

    // Resolve the learning-locale answer set. Awaiting the (cached) sidecar
    // here means grading never races the fetch kicked off elsewhere on the
    // page; for `en` (or a missing id) the English canonical name is used.
    let nativeName = canonicalName;
    let transliteration: string | null = null;
    if (locale !== "en" && id != null) {
      await loadLocaleNames();
      nativeName = getLocaleName(id, locale) ?? canonicalName;
      transliteration = getTransliteration(id, locale) ?? null;
    }

    const grade: Grade = skipAnswer
      ? 1
      : gradeTypedAnswerLocale(
          inputValue,
          { locale, nativeName, transliteration: transliteration ?? undefined },
          strictness,
        ).grade;

    setRevealAnswer({ nativeName, transliteration });
    setFeedbackGrade(grade);
    setSubmitted(true);
    // Hold feedback visible for FEEDBACK_HOLD_MS before notifying the parent.
    // This gives React time to render the result text before the parent
    // unmounts this component (via key change) to advance to the next card.
    // Without the delay the feedback is invisible in the test and on fast
    // devices because the parent's state update races the render commit.
    setTimeout(() => {
      onGrade(grade);
    }, FEEDBACK_HOLD_MS);
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Never submit mid-IME-composition: Enter is confirming a candidate,
    // not submitting the answer (#1576).
    if (composing) return;
    void submit(false);
  }

  // Feedback copy and colour vary by outcome. Non-English cards always show
  // the answer - even on Correct - so the native script + romanisation
  // accept-set is never hidden (#1576, e.g. a romaji answer still teaches
  // the katakana form).
  const feedbackInfo = (() => {
    if (feedbackGrade === 4) {
      return {
        label: t("typedEntry.correct"),
        colour: "text-emerald-600 dark:text-emerald-400",
        showAnswer: locale !== "en",
      };
    }
    if (feedbackGrade === 2) {
      return {
        label: t("typedEntry.close"),
        colour: "text-amber-600 dark:text-amber-400",
        showAnswer: true,
      };
    }
    // feedbackGrade === 1 (Again) or null (pre-submit)
    return {
      label: t("typedEntry.notQuite"),
      colour: "text-red-600 dark:text-red-400",
      showAnswer: true,
    };
  })();

  return (
    <div className="flex flex-col items-center gap-1 sm:gap-4">
      <DirectionBadge direction="name" />
      <Image
        src={spriteUrl}
        alt="A Pokémon sprite, type the name below"
        width={PRACTICE_SPRITE_SIZE}
        height={PRACTICE_SPRITE_SIZE}
        priority
        className="max-h-36 w-auto object-contain sm:max-h-80"
      />

      {/*
        The aria-live region is always present in the DOM so screen readers
        register it before any content is injected. It is empty pre-submit and
        populated post-submit; only the children change, not the element itself.
        Using "polite" because feedback is informational, not a critical alert.
      */}
      <div aria-live="polite" role="status" aria-atomic="true">
        {submitted && (
          <div className="flex flex-col items-center gap-1 text-center">
            <p className={`text-base font-semibold ${feedbackInfo.colour}`}>
              {feedbackInfo.label}
            </p>
            {feedbackInfo.showAnswer &&
              (locale === "en" ? (
                <p className="text-lg font-semibold capitalize text-foreground">
                  {localeDisplayName}
                </p>
              ) : (
                /* Non-English reveal (#1576): native script AND romanisation,
                   so every accepted answer form is visible. */
                <>
                  <p lang={locale} className="text-lg font-semibold text-foreground">
                    {revealAnswer?.nativeName}
                  </p>
                  {revealAnswer?.transliteration !== null &&
                    revealAnswer?.transliteration !== undefined && (
                      <p className={mutedText}>{revealAnswer.transliteration}</p>
                    )}
                </>
              ))}
          </div>
        )}
      </div>

      {/*
        Reserve the same min-height as PokemonCard's answer region (~7rem) so
        the card's bounding box is stable across the pre/post submit states and
        the sprite doesn't drift when feedback expands below it.
      */}
      <div className="min-h-[7rem] flex flex-col items-center justify-center gap-2 w-full max-w-xs">
        {!submitted && (
          /* Pre-submit: input form */
          <form
            onSubmit={handleFormSubmit}
            className="flex flex-col items-center gap-3 w-full"
          >
            <input
              type="text"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              aria-label={t("typedEntry.inputAriaLabel")}
              placeholder={t("typedEntry.inputPlaceholder")}
              disabled={grading}
              className="w-full rounded-lg border border-zinc-300 bg-background px-3 py-2 text-sm text-foreground placeholder-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:border-zinc-700 dark:placeholder-zinc-500 disabled:opacity-60"
            />
            <div className="flex flex-col items-center gap-2 w-full">
              <button
                type="submit"
                disabled={grading || composing}
                className="min-h-[44px] w-full rounded-lg bg-theme-accent px-8 py-2 text-sm font-semibold text-theme-fg-on-primary transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {t("typedEntry.submit")}
              </button>
              <button
                type="button"
                disabled={grading}
                onClick={() => void submit(true)}
                className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 dark:hover:text-zinc-300 disabled:opacity-60"
              >
                {t("typedEntry.dontKnow")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
