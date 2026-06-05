import { describe, it, expect } from "vitest";
import { simulate, ALL_FIXTURES } from "./eval";

describe("simulate", () => {
  it("is deterministic for a given sequence", () => {
    const first = simulate(ALL_FIXTURES[0].steps);
    const second = simulate(ALL_FIXTURES[0].steps);
    expect(second.trace).toEqual(first.trace);
    expect(second.final).toEqual(first.final);
  });
});

describe("fixture snapshots", () => {
  for (const fixture of ALL_FIXTURES) {
    it(`${fixture.name} trace is stable`, () => {
      const { trace } = simulate(fixture.steps);
      // One snapshot per fixture. Intentional scheduler changes will surface
      // here as a diff - review the change, then `vitest -u` to update.
      expect(trace).toMatchSnapshot();
    });
  }
});
