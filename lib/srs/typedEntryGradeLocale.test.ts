import { describe, it, expect } from "vitest";
import {
  gradeTypedAnswerLocale,
  normaliseCjkInput,
  normaliseRomanisation,
  type TypedEntryLocaleAnswer,
} from "./typedEntryGradeLocale";
import { gradeTypedAnswer } from "./typedEntryGrade";

// Real sidecar data (public/pokemon-data/generated-locale-names.json):
//   #25 Pikachu    ja ピカチュウ / "Pikachu"      zh 皮卡丘 / "pí kǎ qiū"
//   #1  Bulbasaur  ja フシギダネ / "Fushigidane"  zh-Hans 妙蛙种子 / "miào wā zhǒng zi"
//                                                zh-Hant 妙蛙種子 / "miào wā zhǒng zǐ"
//   #6  Charizard  ja リザードン / "Lizardon"
const PIKACHU_JA: TypedEntryLocaleAnswer = {
  locale: "ja",
  nativeName: "ピカチュウ",
  transliteration: "Pikachu",
};
const PIKACHU_HANS: TypedEntryLocaleAnswer = {
  locale: "zh-Hans",
  nativeName: "皮卡丘",
  transliteration: "pí kǎ qiū",
};
const BULBASAUR_HANS: TypedEntryLocaleAnswer = {
  locale: "zh-Hans",
  nativeName: "妙蛙种子",
  transliteration: "miào wā zhǒng zi",
};
const BULBASAUR_HANT: TypedEntryLocaleAnswer = {
  locale: "zh-Hant",
  nativeName: "妙蛙種子",
  transliteration: "miào wā zhǒng zǐ",
};

// ─── English delegation fitness test (#1576 regression guarantee) ───────────

describe("gradeTypedAnswerLocale: en delegates byte-for-byte to gradeTypedAnswer", () => {
  const cases: Array<[string, string]> = [
    ["pikachu", "Pikachu"],
    ["Pikachu", "Pikachu"],
    ["porygon z", "Porygon-Z"],
    ["farfetchd", "Farfetch’d"],
    ["nidoran", "Nidoran♀"],
    ["pikchu", "Pikachu"], // near miss
    ["charizard", "Pikachu"], // wrong
    ["", "Pikachu"], // empty = skip
    ["  flabébé  ", "Flabébé"], // accents preserved on the en path
    ["flabebe", "Flabébé"], // accented near-miss stays a near-miss
  ];

  it.each(cases)("input %j vs %j is identical to gradeTypedAnswer", (input, name) => {
    const expected = gradeTypedAnswer(input, name);
    expect(
      gradeTypedAnswerLocale(input, { locale: "en", nativeName: name }, "lenient"),
    ).toEqual(expected);
    expect(
      gradeTypedAnswerLocale(input, { locale: "en", nativeName: name }, "strict"),
    ).toEqual(expected);
  });

  it("ignores a transliteration on the en path (mode and extra data are inert)", () => {
    expect(
      gradeTypedAnswerLocale(
        "pikachu",
        { locale: "en", nativeName: "Raichu", transliteration: "pikachu" },
        "lenient",
      ),
    ).toEqual(gradeTypedAnswer("pikachu", "Raichu"));
  });
});

// ─── Japanese ────────────────────────────────────────────────────────────────

describe("gradeTypedAnswerLocale: ja", () => {
  it("exact katakana match grades Good in both modes", () => {
    expect(gradeTypedAnswerLocale("ピカチュウ", PIKACHU_JA, "lenient")).toEqual({
      grade: 4,
      distance: 0,
    });
    expect(gradeTypedAnswerLocale("ピカチュウ", PIKACHU_JA, "strict")).toEqual({
      grade: 4,
      distance: 0,
    });
  });

  it("hiragana input matches the katakana name (kana folding, both modes)", () => {
    expect(gradeTypedAnswerLocale("ぴかちゅう", PIKACHU_JA, "lenient").grade).toBe(4);
    expect(gradeTypedAnswerLocale("ぴかちゅう", PIKACHU_JA, "strict").grade).toBe(4);
  });

  it("half-width katakana folds via NFKC and matches", () => {
    expect(gradeTypedAnswerLocale("ﾋﾟｶﾁｭｳ", PIKACHU_JA, "strict").grade).toBe(4);
  });

  it("keeps the prolonged sound mark ー significant", () => {
    const lizardon: TypedEntryLocaleAnswer = {
      locale: "ja",
      nativeName: "リザードン",
      transliteration: "Lizardon",
    };
    expect(gradeTypedAnswerLocale("りざーどん", lizardon, "strict").grade).toBe(4);
    // Dropping the ー is a one-edit near miss, not a match.
    expect(gradeTypedAnswerLocale("リザドン", lizardon, "strict")).toEqual({
      grade: 2,
      distance: 1,
    });
  });

  it("near-miss native (one kana off) grades Hard", () => {
    expect(gradeTypedAnswerLocale("ピカチュ", PIKACHU_JA, "strict")).toEqual({
      grade: 2,
      distance: 1,
    });
  });

  it("rōmaji is accepted in lenient mode (case/space-insensitive)", () => {
    expect(gradeTypedAnswerLocale("pikachu", PIKACHU_JA, "lenient").grade).toBe(4);
    expect(gradeTypedAnswerLocale("PIKA CHU", PIKACHU_JA, "lenient").grade).toBe(4);
    // Full-width Latin folds via NFKC before the romanised comparison.
    expect(gradeTypedAnswerLocale("Ｐｉｋａｃｈｕ", PIKACHU_JA, "lenient").grade).toBe(4);
  });

  it("rōmaji near-miss grades Hard in lenient mode", () => {
    expect(gradeTypedAnswerLocale("pikachuu", PIKACHU_JA, "lenient")).toEqual({
      grade: 2,
      distance: 1,
    });
  });

  it("rōmaji is rejected in strict mode", () => {
    expect(gradeTypedAnswerLocale("pikachu", PIKACHU_JA, "strict").grade).toBe(1);
  });

  it("plain wrong answer grades Again in both modes", () => {
    expect(gradeTypedAnswerLocale("イーブイ", PIKACHU_JA, "lenient").grade).toBe(1);
    expect(gradeTypedAnswerLocale("eevee", PIKACHU_JA, "lenient").grade).toBe(1);
    expect(gradeTypedAnswerLocale("イーブイ", PIKACHU_JA, "strict").grade).toBe(1);
  });

  it("missing transliteration falls back to native-only matching without crashing", () => {
    const noTranslit: TypedEntryLocaleAnswer = { locale: "ja", nativeName: "ピカチュウ" };
    expect(gradeTypedAnswerLocale("ピカチュウ", noTranslit, "lenient").grade).toBe(4);
    expect(gradeTypedAnswerLocale("pikachu", noTranslit, "lenient").grade).toBe(1);
  });

  it("empty input grades Again", () => {
    expect(gradeTypedAnswerLocale("", PIKACHU_JA, "lenient").grade).toBe(1);
    expect(gradeTypedAnswerLocale("  。、 ", PIKACHU_JA, "lenient").grade).toBe(1);
  });
});

// ─── Chinese (Simplified) ────────────────────────────────────────────────────

describe("gradeTypedAnswerLocale: zh-Hans", () => {
  it("exact native match grades Good in both modes", () => {
    expect(gradeTypedAnswerLocale("皮卡丘", PIKACHU_HANS, "strict")).toEqual({
      grade: 4,
      distance: 0,
    });
    expect(gradeTypedAnswerLocale("妙蛙种子", BULBASAUR_HANS, "lenient").grade).toBe(4);
  });

  it("near-miss native (one character off) grades Hard", () => {
    expect(gradeTypedAnswerLocale("皮卡", PIKACHU_HANS, "strict")).toEqual({
      grade: 2,
      distance: 1,
    });
  });

  it("tone-marked pinyin is accepted in lenient mode", () => {
    expect(gradeTypedAnswerLocale("pí kǎ qiū", PIKACHU_HANS, "lenient").grade).toBe(4);
  });

  it("tone-stripped, spacing- and case-variant pinyin is accepted in lenient mode", () => {
    expect(gradeTypedAnswerLocale("pikaqiu", PIKACHU_HANS, "lenient").grade).toBe(4);
    expect(gradeTypedAnswerLocale("pi ka qiu", PIKACHU_HANS, "lenient").grade).toBe(4);
    expect(gradeTypedAnswerLocale("PiKaQiu", PIKACHU_HANS, "lenient").grade).toBe(4);
    expect(
      gradeTypedAnswerLocale("miao wa zhong zi", BULBASAUR_HANS, "lenient").grade,
    ).toBe(4);
  });

  it("pinyin is rejected in strict mode", () => {
    expect(gradeTypedAnswerLocale("pikaqiu", PIKACHU_HANS, "strict").grade).toBe(1);
    expect(gradeTypedAnswerLocale("pí kǎ qiū", PIKACHU_HANS, "strict").grade).toBe(1);
  });

  it("plain wrong answer grades Again", () => {
    expect(gradeTypedAnswerLocale("妙蛙种子", PIKACHU_HANS, "lenient").grade).toBe(1);
    expect(gradeTypedAnswerLocale("miaowazhongzi", PIKACHU_HANS, "lenient").grade).toBe(1);
  });

  it("traditional-script input against a Hans name is a near-miss, not a hard fail (lenient)", () => {
    // 種 (Hant) vs 种 (Hans): distinct code points, one substitution.
    expect(gradeTypedAnswerLocale("妙蛙種子", BULBASAUR_HANS, "lenient")).toEqual({
      grade: 2,
      distance: 1,
    });
  });
});

// ─── Chinese (Traditional) ───────────────────────────────────────────────────

describe("gradeTypedAnswerLocale: zh-Hant", () => {
  it("exact native match grades Good in both modes", () => {
    expect(gradeTypedAnswerLocale("妙蛙種子", BULBASAUR_HANT, "strict")).toEqual({
      grade: 4,
      distance: 0,
    });
    expect(gradeTypedAnswerLocale("妙蛙種子", BULBASAUR_HANT, "lenient").grade).toBe(4);
  });

  it("near-miss native grades Hard", () => {
    expect(gradeTypedAnswerLocale("妙蛙種", BULBASAUR_HANT, "strict")).toEqual({
      grade: 2,
      distance: 1,
    });
  });

  it("tone-marked and tone-stripped pinyin are accepted in lenient mode", () => {
    expect(
      gradeTypedAnswerLocale("miào wā zhǒng zǐ", BULBASAUR_HANT, "lenient").grade,
    ).toBe(4);
    expect(
      gradeTypedAnswerLocale("miaowazhongzi", BULBASAUR_HANT, "lenient").grade,
    ).toBe(4);
  });

  it("pinyin is rejected in strict mode", () => {
    expect(gradeTypedAnswerLocale("miaowazhongzi", BULBASAUR_HANT, "strict").grade).toBe(1);
  });

  it("plain wrong answer grades Again", () => {
    expect(gradeTypedAnswerLocale("皮卡丘", BULBASAUR_HANT, "lenient").grade).toBe(1);
  });

  it("simplified-script input against a Hant name is a near-miss, not a hard fail (lenient)", () => {
    expect(gradeTypedAnswerLocale("妙蛙种子", BULBASAUR_HANT, "lenient")).toEqual({
      grade: 2,
      distance: 1,
    });
  });
});

// ─── Normalisers ─────────────────────────────────────────────────────────────

describe("normaliseCjkInput", () => {
  it("applies NFKC: folds full-width forms and CJK compatibility ideographs", () => {
    // U+FA19 神 (compatibility ideograph) folds to U+795E 神.
    expect(normaliseCjkInput("神", "zh-Hant")).toBe("神");
    expect(normaliseCjkInput("ポリゴンＺ", "zh-Hans")).toBe("ポリゴンz");
    expect(normaliseCjkInput("ﾋﾟｶﾁｭｳ", "zh-Hans")).toBe("ピカチュウ");
  });

  it("strips ASCII and CJK punctuation, symbols, and whitespace (incl. U+3000)", () => {
    expect(normaliseCjkInput("ピカ・チュウ!？、。「」　", "zh-Hans")).toBe("ピカチュウ");
    expect(normaliseCjkInput("ニドラン♀", "zh-Hans")).toBe("ニドラン");
  });

  it("folds katakana to hiragana for ja only", () => {
    expect(normaliseCjkInput("ピカチュウ", "ja")).toBe("ぴかちゅう");
    expect(normaliseCjkInput("ピカチュウ", "zh-Hans")).toBe("ピカチュウ");
    // ー (prolonged sound mark) survives both folding and punctuation stripping.
    expect(normaliseCjkInput("リザードン", "ja")).toBe("りざーどん");
  });
});

describe("normaliseRomanisation", () => {
  it("strips pinyin tone diacritics via NFD + combining-mark removal", () => {
    expect(normaliseRomanisation("miào wā zhǒng zǐ")).toBe("miaowazhongzi");
    expect(normaliseRomanisation("pí kǎ qiū")).toBe("pikaqiu");
  });

  it("lowercases and strips spaces and punctuation", () => {
    expect(normaliseRomanisation("  Fushigi-Dane ")).toBe("fushigidane");
    expect(normaliseRomanisation("Ｐｉｋａｃｈｕ")).toBe("pikachu");
  });
});
