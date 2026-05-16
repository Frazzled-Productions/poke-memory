import { describe, it, expect } from "vitest";
import { pronunciationFor, stripDecorativeSymbols } from "./pronunciations";

describe("stripDecorativeSymbols", () => {
  it("removes the ♀ symbol", () => {
    expect(stripDecorativeSymbols("Nidoran♀")).toBe("Nidoran");
  });

  it("removes the ♂ symbol", () => {
    expect(stripDecorativeSymbols("Nidoran♂")).toBe("Nidoran");
  });

  it("collapses whitespace left by a mid-word symbol", () => {
    // e.g. "Foo ♀ Bar" → "Foo Bar"
    expect(stripDecorativeSymbols("Foo ♀ Bar")).toBe("Foo Bar");
  });

  it("trims leading/trailing whitespace after stripping", () => {
    expect(stripDecorativeSymbols("♀Nidoran")).toBe("Nidoran");
    expect(stripDecorativeSymbols("Nidoran♂ ")).toBe("Nidoran");
  });

  it("leaves apostrophes, accents, hyphens, and parentheses untouched", () => {
    expect(stripDecorativeSymbols("Farfetch'd")).toBe("Farfetch'd");
    expect(stripDecorativeSymbols("Flabébé")).toBe("Flabébé");
    expect(stripDecorativeSymbols("Ho-Oh")).toBe("Ho-Oh");
    expect(stripDecorativeSymbols("Type: Null")).toBe("Type: Null");
  });

  it("is a no-op for names with no gender symbols", () => {
    expect(stripDecorativeSymbols("Bulbasaur")).toBe("Bulbasaur");
    expect(stripDecorativeSymbols("Pikachu")).toBe("Pikachu");
  });
});

describe("pronunciationFor", () => {
  it("returns the override when a name has a curated entry", () => {
    expect(pronunciationFor("Mewtwo")).toBe("mew two");
    expect(pronunciationFor("Rayquaza")).toBe("ray kwah zuh");
    expect(pronunciationFor("Vaporeon")).toBe("vay por ee on");
  });

  it("matches case-insensitively on the input", () => {
    expect(pronunciationFor("MEWTWO")).toBe("mew two");
    expect(pronunciationFor("mewtwo")).toBe("mew two");
    expect(pronunciationFor("MeWtWo")).toBe("mew two");
  });

  it("returns the input verbatim when no override exists", () => {
    expect(pronunciationFor("Bulbasaur")).toBe("Bulbasaur");
    expect(pronunciationFor("Pikachu")).toBe("Pikachu");
  });

  it("handles hyphenated names whose hyphen confuses the synth", () => {
    expect(pronunciationFor("Ho-Oh")).toBe("ho oh");
    expect(pronunciationFor("Porygon-Z")).toBe("porygon zee");
  });

  it("strips ♀ from Nidoran♀ and returns the stripped name (no override needed)", () => {
    expect(pronunciationFor("Nidoran♀")).toBe("Nidoran");
  });

  it("strips ♂ from Nidoran♂ and returns the stripped name (no override needed)", () => {
    expect(pronunciationFor("Nidoran♂")).toBe("Nidoran");
  });

  it("still resolves overrides for names with apostrophes after stripping", () => {
    expect(pronunciationFor("Farfetch'd")).toBe("farfetched");
  });
});
