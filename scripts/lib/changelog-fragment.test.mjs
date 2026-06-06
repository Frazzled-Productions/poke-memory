import { describe, it, expect } from "vitest";
import { parseFragment, VALID_KINDS } from "./changelog-fragment.mjs";

describe("parseFragment", () => {
  it("parses a minimal kind-only fragment", () => {
    const result = parseFragment("---\nkind: fixed\n---\n- Fixed a thing.\n");
    expect(result).toEqual({ ok: true, kind: "fixed", bullets: ["- Fixed a thing."] });
  });

  it("tolerates an extra `issue:` front-matter key (the #1664 regression)", () => {
    // This exact shape (1607/1643) broke the old strict cut-release regex while
    // passing the old lint. The shared parser must accept it.
    const text = "---\nkind: changed\nissue: 1607\n---\n- Did a thing.\n";
    const result = parseFragment(text);
    expect(result).toEqual({ ok: true, kind: "changed", bullets: ["- Did a thing."] });
  });

  it("tolerates extra keys regardless of order relative to kind", () => {
    const text = "---\nissue: 42\nkind: added\n---\n- Added a thing.\n";
    expect(parseFragment(text)).toEqual({
      ok: true,
      kind: "added",
      bullets: ["- Added a thing."],
    });
  });

  it("lower-cases the kind", () => {
    expect(parseFragment("---\nkind: Fixed\n---\n- x\n").kind).toBe("fixed");
  });

  it("accepts minor-bump with no bullet body", () => {
    expect(parseFragment("---\nkind: minor-bump\n---\n")).toEqual({
      ok: true,
      kind: "minor-bump",
      bullets: [],
    });
  });

  it("collects multiple bullets", () => {
    const text = "---\nkind: added\n---\n- One.\n- Two.\n";
    expect(parseFragment(text).bullets).toEqual(["- One.", "- Two."]);
  });

  it("handles CRLF line endings", () => {
    const result = parseFragment("---\r\nkind: fixed\r\n---\r\n- A thing.\r\n");
    expect(result).toEqual({ ok: true, kind: "fixed", bullets: ["- A thing."] });
  });

  it("rejects a missing opening delimiter", () => {
    const result = parseFragment("kind: fixed\n- x\n");
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/opening YAML front-matter delimiter/);
  });

  it("rejects a missing closing delimiter", () => {
    const result = parseFragment("---\nkind: fixed\n- x\n");
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/closing YAML front-matter delimiter/);
  });

  it("rejects front-matter with no kind field", () => {
    const result = parseFragment("---\nissue: 1\n---\n- x\n");
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/no `kind:` field/);
  });

  it("rejects an unknown kind", () => {
    const result = parseFragment("---\nkind: bogus\n---\n- x\n");
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/not valid/);
  });

  it("rejects a non-minor-bump fragment with no bullet", () => {
    const result = parseFragment("---\nkind: fixed\n---\n\n");
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/no `- ` bullet line/);
  });

  it("exports the full set of valid kinds", () => {
    expect(VALID_KINDS).toContain("minor-bump");
    expect(VALID_KINDS).toContain("fixed");
    expect(VALID_KINDS).toHaveLength(7);
  });
});
