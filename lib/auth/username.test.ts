/**
 * Unit tests for lib/auth/username.ts.
 *
 * Covers:
 *  - normaliseUsername: case conversion, whitespace trimming.
 *  - validateUsername: length bounds, allowed characters, edge cases.
 *  - syntheticEmail: deterministic derivation, INTERNAL_DOMAIN constant.
 */

import { describe, it, expect } from "vitest";
import {
  normaliseUsername,
  validateUsername,
  syntheticEmail,
  INTERNAL_DOMAIN,
  USERNAME_PATTERN,
} from "./username";

// ---------------------------------------------------------------------------
// normaliseUsername
// ---------------------------------------------------------------------------

describe("normaliseUsername", () => {
  it("lowercases uppercase input", () => {
    expect(normaliseUsername("Trainer123")).toBe("trainer123");
  });

  it("trims leading whitespace", () => {
    expect(normaliseUsername("  ash")).toBe("ash");
  });

  it("trims trailing whitespace", () => {
    expect(normaliseUsername("ash  ")).toBe("ash");
  });

  it("trims both sides and lowercases", () => {
    expect(normaliseUsername("  MISTY  ")).toBe("misty");
  });

  it("preserves digits", () => {
    expect(normaliseUsername("Ash99")).toBe("ash99");
  });

  it("preserves underscores and hyphens", () => {
    expect(normaliseUsername("Cool-Trainer_1")).toBe("cool-trainer_1");
  });

  it("already-normalised string is unchanged", () => {
    expect(normaliseUsername("brock")).toBe("brock");
  });

  it("does not strip internal spaces (validation will reject them)", () => {
    // Internal whitespace is NOT trimmed by normalise - validation catches it.
    expect(normaliseUsername("ash ketchum")).toBe("ash ketchum");
  });
});

// ---------------------------------------------------------------------------
// validateUsername
// ---------------------------------------------------------------------------

describe("validateUsername", () => {
  it("returns null for a valid 3-char username", () => {
    expect(validateUsername("ash")).toBeNull();
  });

  it("returns null for a valid 30-char username", () => {
    expect(validateUsername("a".repeat(30))).toBeNull();
  });

  it("returns null for username with digits", () => {
    expect(validateUsername("trainer99")).toBeNull();
  });

  it("returns null for username with hyphens and underscores", () => {
    expect(validateUsername("cool-trainer_x")).toBeNull();
  });

  it("returns username_too_short for empty string", () => {
    expect(validateUsername("")).toBe("username_too_short");
  });

  it("returns username_too_short for 1-char input", () => {
    expect(validateUsername("a")).toBe("username_too_short");
  });

  it("returns username_too_short for 2-char input", () => {
    expect(validateUsername("ab")).toBe("username_too_short");
  });

  it("returns username_too_long for 31-char input", () => {
    expect(validateUsername("a".repeat(31))).toBe("username_too_long");
  });

  it("returns username_too_long for very long input", () => {
    expect(validateUsername("z".repeat(100))).toBe("username_too_long");
  });

  it("returns username_invalid_chars for uppercase letters", () => {
    // Normalisation is the caller's responsibility; uppercase is invalid here.
    expect(validateUsername("Trainer")).toBe("username_invalid_chars");
  });

  it("returns username_invalid_chars for spaces", () => {
    expect(validateUsername("ash ketchum")).toBe("username_invalid_chars");
  });

  it("returns username_invalid_chars for special characters", () => {
    expect(validateUsername("ash!")).toBe("username_invalid_chars");
    expect(validateUsername("ash@poke")).toBe("username_invalid_chars");
    expect(validateUsername("ash.ketchum")).toBe("username_invalid_chars");
  });

  it("returns username_invalid_chars for unicode letters outside [a-z]", () => {
    expect(validateUsername("traineré")).toBe("username_invalid_chars");
    expect(validateUsername("トレーナー")).toBe("username_invalid_chars");
  });
});

// ---------------------------------------------------------------------------
// USERNAME_PATTERN
// ---------------------------------------------------------------------------

describe("USERNAME_PATTERN", () => {
  it("matches a valid normalised username", () => {
    expect(USERNAME_PATTERN.test("trainer99")).toBe(true);
  });

  it("does not match uppercase", () => {
    expect(USERNAME_PATTERN.test("Trainer")).toBe(false);
  });

  it("does not match too-short strings", () => {
    expect(USERNAME_PATTERN.test("ab")).toBe(false);
  });

  it("does not match too-long strings", () => {
    expect(USERNAME_PATTERN.test("a".repeat(31))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// syntheticEmail
// ---------------------------------------------------------------------------

describe("syntheticEmail", () => {
  it("produces email in the form username@INTERNAL_DOMAIN", () => {
    const email = syntheticEmail("ash");
    expect(email).toBe(`ash@${INTERNAL_DOMAIN}`);
  });

  it("INTERNAL_DOMAIN is stable and not a real mail domain", () => {
    // Must contain 'noreply' or 'internal' to signal it receives no mail.
    expect(
      INTERNAL_DOMAIN.includes("noreply") || INTERNAL_DOMAIN.includes("internal"),
    ).toBe(true);
  });

  it("derivation is deterministic - same input gives same output", () => {
    expect(syntheticEmail("misty")).toBe(syntheticEmail("misty"));
  });

  it("different usernames produce different emails", () => {
    expect(syntheticEmail("ash")).not.toBe(syntheticEmail("brock"));
  });

  it("produces a valid email-like format", () => {
    const email = syntheticEmail("trainer99");
    expect(email).toContain("@");
    expect(email.startsWith("trainer99@")).toBe(true);
  });
});
