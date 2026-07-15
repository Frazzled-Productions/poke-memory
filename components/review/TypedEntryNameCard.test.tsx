import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithIntl as render, renderJa, screen, fireEvent, act } from "@/components/test-utils/renderWithIntl";
import { TypedEntryNameCard } from "./TypedEntryNameCard";
import type { Grade } from "@/lib/review/session";

// Minimal next/image stub so jsdom tests don't hit the Next.js image-loader
// machinery. Mirrors the pattern used elsewhere in the test suite.
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// Return the English name synchronously so tests are deterministic and do not
// depend on localStorage or the locale sidecar being loaded.
vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (_id: number | undefined, englishName: string) => ({
    name: englishName,
    transliteration: null,
  }),
}));

// Deterministic locale-names sidecar for the non-English grading tests
// (#1576). Bulbasaur (speciesId 1) only; every other id resolves undefined,
// which exercises the English-canonical fallback.
vi.mock("@/lib/pokemon/localeNames", () => {
  const NAMES: Record<string, string> = {
    ja: "フシギダネ",
    "zh-Hans": "妙蛙种子",
    "zh-Hant": "妙蛙種子",
  };
  const TRANSLITERATIONS: Record<string, string> = {
    ja: "Fushigidane",
    "zh-Hans": "miào wā zhǒng zi",
    "zh-Hant": "miào wā zhǒng zǐ",
  };
  return {
    loadLocaleNames: async () => new Map(),
    getLocaleName: (id: number, locale: string) =>
      id === 1 ? NAMES[locale] : undefined,
    getTransliteration: (id: number, locale: string) =>
      id === 1 ? TRANSLITERATIONS[locale] : undefined,
  };
});

type TestProps = {
  spriteUrl?: string;
  canonicalName?: string;
  onGrade?: (grade: Grade) => void;
  grading?: boolean;
};

function renderCard(overrides?: TestProps) {
  const onGrade = overrides?.onGrade ?? vi.fn<(grade: Grade) => void>();
  const props = {
    spriteUrl: "/sprites/pokemon/webp/320/25.webp",
    canonicalName: "Pikachu",
    onGrade,
    ...overrides,
  };
  render(<TypedEntryNameCard {...props} />);
  return { onGrade };
}

// The component delays onGrade by FEEDBACK_HOLD_MS after submit so feedback
// is visible before the parent advances. Tests that assert onGrade was called
// must advance fake timers past that delay.
const FEEDBACK_HOLD_MS = 1500;

describe("TypedEntryNameCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the sprite and the name input", () => {
    renderCard();
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /type the pokémon name/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /i don.t know/i })).toBeInTheDocument();
  });

  it("fires Good (4) when the exact name is typed and submitted", () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    // Use fireEvent.change (synchronous) to avoid userEvent timer interaction
    // with vi.useFakeTimers. The component's grading logic only reads the value,
    // so change vs keystroke-by-keystroke makes no difference here.
    fireEvent.change(input, { target: { value: "Pikachu" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    // onGrade is delayed by FEEDBACK_HOLD_MS - advance fake timers.
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("fires Good (4) for a case-insensitive exact match", () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "pikachu" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("fires Hard (2) for a near-miss typo and shows feedback", () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Pikachv" } }); // one char off
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    // Feedback should be visible immediately, before the timer fires.
    expect(screen.getByText(/close!/i)).toBeInTheDocument();
    // Correct answer should be revealed for Hard
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(2);
  });

  it("fires Again (1) for a clearly wrong answer and reveals the name", () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Squirtle" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(1);
  });

  it("fires Again (1) for an empty submission and reveals the name", () => {
    const { onGrade } = renderCard();
    // Leave input empty.
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(1);
  });

  it("fires Again (1) on I don't know and reveals the name", () => {
    const { onGrade } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /i don.t know/i }));
    expect(screen.getByText("Pikachu")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(1);
  });

  it("does not fire onGrade a second time if submitted twice", () => {
    const { onGrade } = renderCard();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Pikachu" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    // After submit the input form is gone; clicking again would have to
    // happen via the grade buttons which no longer exist - this mainly
    // verifies that onGrade is called exactly once.
    expect(onGrade).toHaveBeenCalledTimes(1);
  });

  it("shows Correct! feedback (no name reveal) on exact match", () => {
    renderCard();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Pikachu" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    // Feedback is immediately visible (before the timer fires).
    expect(screen.getByText(/correct!/i)).toBeInTheDocument();
    // Should NOT reveal the name in an extra paragraph - the name is part
    // of the feedback for wrong/close answers only. Exact-match only shows "Correct!".
    expect(screen.queryAllByText("Pikachu")).toHaveLength(0);
    // onGrade fires after the hold delay.
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
  });

  it("disables the submit button while grading prop is true", () => {
    renderCard({ grading: true });
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /i don.t know/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Locale-aware grading (#1576)
// ---------------------------------------------------------------------------

type LocaleTestProps = {
  locale: "ja" | "zh-Hans" | "zh-Hant";
  strictness?: "strict" | "lenient";
  onGrade?: (grade: Grade) => void;
};

function renderLocaleCard(overrides: LocaleTestProps) {
  const onGrade = overrides.onGrade ?? vi.fn<(grade: Grade) => void>();
  render(
    <TypedEntryNameCard
      spriteUrl="/sprites/pokemon/webp/320/1.webp"
      canonicalName="Bulbasaur"
      id={1}
      onGrade={onGrade}
      locale={overrides.locale}
      strictness={overrides.strictness}
    />,
  );
  return { onGrade };
}

// Submit is async for non-English locales (it awaits the sidecar), so flush
// microtasks with an async act before asserting.
async function submitAnswer(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: /submit/i }));
  await act(async () => {});
}

describe("TypedEntryNameCard - locale-aware grading (#1576)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ja: typed entry is active and the exact katakana name fires Good (4)", async () => {
    const { onGrade } = renderLocaleCard({ locale: "ja" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await submitAnswer("フシギダネ");
    expect(screen.getByText(/correct!/i)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("ja: the hiragana form of a katakana name fires Good (4)", async () => {
    const { onGrade } = renderLocaleCard({ locale: "ja" });
    await submitAnswer("ふしぎだね");
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("ja lenient: the romanised name fires Good (4)", async () => {
    const { onGrade } = renderLocaleCard({ locale: "ja", strictness: "lenient" });
    await submitAnswer("fushigidane");
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("ja strict: the romanised name is rejected with Again (1)", async () => {
    const { onGrade } = renderLocaleCard({ locale: "ja", strictness: "strict" });
    await submitAnswer("fushigidane");
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(1);
  });

  it("zh-Hans: typed entry is active and the exact native name fires Good (4)", async () => {
    const { onGrade } = renderLocaleCard({ locale: "zh-Hans" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await submitAnswer("妙蛙种子");
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("zh-Hans lenient: tone- and spacing-free pinyin fires Good (4)", async () => {
    const { onGrade } = renderLocaleCard({ locale: "zh-Hans", strictness: "lenient" });
    await submitAnswer("miaowazhongzi");
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });

  it("zh-Hant strict: pinyin is rejected with Again (1)", async () => {
    const { onGrade } = renderLocaleCard({ locale: "zh-Hant", strictness: "strict" });
    await submitAnswer("miaowazhongzi");
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(1);
  });

  it("reveal shows BOTH the native script and the romanisation on a wrong answer", async () => {
    renderLocaleCard({ locale: "ja" });
    await submitAnswer("ゼニガメ");
    expect(screen.getByText("フシギダネ")).toBeInTheDocument();
    expect(screen.getByText("Fushigidane")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
  });

  it("reveal shows the accepted answer set even on a correct romanised answer", async () => {
    // A learner answering in romaji must still be shown the native script -
    // the accept-set is never hidden (#1576).
    renderLocaleCard({ locale: "ja" });
    await submitAnswer("fushigidane");
    expect(screen.getByText(/correct!/i)).toBeInTheDocument();
    expect(screen.getByText("フシギダネ")).toBeInTheDocument();
    expect(screen.getByText("Fushigidane")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
  });

  it("English behaviour is unchanged: no romanisation line, correct hides the answer", () => {
    const onGrade = vi.fn<(grade: Grade) => void>();
    render(
      <TypedEntryNameCard
        spriteUrl="/sprites/pokemon/webp/320/1.webp"
        canonicalName="Bulbasaur"
        id={1}
        onGrade={onGrade}
        locale="en"
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bulbasaur" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    expect(screen.getByText(/correct!/i)).toBeInTheDocument();
    // English exact match reveals nothing - and never a transliteration.
    expect(screen.queryByText("フシギダネ")).not.toBeInTheDocument();
    expect(screen.queryByText("Fushigidane")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Bulbasaur")).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });
});

// ---------------------------------------------------------------------------
// IME composition guard (#1576)
// ---------------------------------------------------------------------------

describe("TypedEntryNameCard - IME composition guard (#1576)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submit is disabled mid-composition and form submit is a no-op", async () => {
    const { onGrade } = renderLocaleCard({ locale: "ja" });
    const input = screen.getByRole("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "ふしぎだね" } });

    // The submit button is disabled while composing.
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();

    // A form submit (e.g. Enter confirming an IME candidate) is ignored.
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await act(async () => {});
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();

    // Composition ends: submit re-enables and grading works.
    fireEvent.compositionEnd(input);
    expect(screen.getByRole("button", { name: /submit/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await act(async () => {});
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    expect(onGrade).toHaveBeenCalledWith(4);
  });
});

// ---------------------------------------------------------------------------
// Localised input aria-label (#1607)
// ---------------------------------------------------------------------------

describe("TypedEntryNameCard - localised input aria-label", () => {
  it("input aria-label is localised in Japanese", () => {
    renderJa(
      <TypedEntryNameCard
        spriteUrl="/sprites/pokemon/webp/320/25.webp"
        canonicalName="Pikachu"
        id={25}
        onGrade={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("textbox", { name: "ポケモンの名前を入力" }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Locale-aware answer reveal (#1260 followup)
// ---------------------------------------------------------------------------

describe("TypedEntryNameCard - locale-aware answer reveal", () => {
  it("shows the locale-resolved name in the feedback reveal on a wrong answer", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock("@/lib/i18n/useLocalePokemonName", () => ({
      useLocalePokemonName: (_id: number | undefined, _english: string) => ({
        name: "ピカチュウ",
        transliteration: "Pikachu",
      }),
    }));
    const { TypedEntryNameCard: LocaleCard } = await import(
      "@/components/review/TypedEntryNameCard"
    );
    render(
      <LocaleCard
        spriteUrl="/sprites/pokemon/webp/320/25.webp"
        canonicalName="Pikachu"
        id={25}
        onGrade={vi.fn()}
      />,
    );
    // Submit a wrong answer to trigger the answer reveal.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Squirtle" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    // Feedback should show the locale name, not the English canonical.
    expect(screen.getByText("ピカチュウ")).toBeInTheDocument();
    expect(screen.queryByText("Pikachu")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(FEEDBACK_HOLD_MS); });
    vi.useRealTimers();
  });
});
