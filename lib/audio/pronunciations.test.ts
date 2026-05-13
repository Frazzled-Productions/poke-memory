import { describe, it, expect } from "vitest";
import { pronunciationFor } from "./pronunciations";

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
});
