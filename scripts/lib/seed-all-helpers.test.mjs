import { describe, it, expect } from "vitest";
import {
  parseArgs,
  buildStepList,
  stepScriptNames,
  formatStepBanner,
  formatStepFailure,
  formatSuccess,
} from "./seed-all-helpers.mjs";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("returns force:false when no flags given", () => {
    expect(parseArgs([])).toEqual({ force: false });
  });

  it("returns force:true when --force flag is present", () => {
    expect(parseArgs(["--force"])).toEqual({ force: true });
  });

  it("tolerates unknown flags alongside --force", () => {
    expect(parseArgs(["--force", "--unknown"])).toEqual({ force: true });
  });

  it("returns force:false for unrelated flags", () => {
    expect(parseArgs(["--verbose"])).toEqual({ force: false });
  });
});

// ---------------------------------------------------------------------------
// buildStepList - step order
// ---------------------------------------------------------------------------

describe("buildStepList - step order", () => {
  const steps = buildStepList({ force: false, hasTtsKey: true });
  const names = stepScriptNames(steps);

  it("starts with seed", () => {
    expect(names[0]).toBe("seed");
  });

  it("seed:sprites comes after seed", () => {
    expect(names.indexOf("seed:sprites")).toBeGreaterThan(names.indexOf("seed"));
  });

  it("seed:tts comes after seed:sprites", () => {
    expect(names.indexOf("seed:tts")).toBeGreaterThan(names.indexOf("seed:sprites"));
  });

  it("seed:split comes after seed:tts", () => {
    expect(names.indexOf("seed:split")).toBeGreaterThan(names.indexOf("seed:tts"));
  });

  it("generate:scope-lookup comes after seed:split", () => {
    expect(names.indexOf("generate:scope-lookup")).toBeGreaterThan(
      names.indexOf("seed:split"),
    );
  });

  it("generate:pseudo-locale is the last step", () => {
    expect(names[names.length - 1]).toBe("generate:pseudo-locale");
  });

  it("contains exactly the expected six steps", () => {
    expect(names).toEqual([
      "seed",
      "seed:sprites",
      "seed:tts",
      "seed:split",
      "generate:scope-lookup",
      "generate:pseudo-locale",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildStepList - TTS key absent
// ---------------------------------------------------------------------------

describe("buildStepList - TTS key absent", () => {
  const steps = buildStepList({ force: false, hasTtsKey: false });
  const ttsStep = steps.find((s) => s.script === "seed:tts");

  it("TTS step has a non-null skipReason", () => {
    expect(ttsStep.skipReason).not.toBeNull();
  });

  it("skipReason mentions GOOGLE_CLOUD_TTS_API_KEY", () => {
    expect(ttsStep.skipReason).toContain("GOOGLE_CLOUD_TTS_API_KEY");
  });

  it("other steps still have null skipReason", () => {
    const others = steps.filter((s) => s.script !== "seed:tts");
    for (const step of others) {
      expect(step.skipReason).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// buildStepList - TTS key present
// ---------------------------------------------------------------------------

describe("buildStepList - TTS key present", () => {
  const steps = buildStepList({ force: false, hasTtsKey: true });
  const ttsStep = steps.find((s) => s.script === "seed:tts");

  it("TTS step has null skipReason when key is present", () => {
    expect(ttsStep.skipReason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildStepList - --force propagation
// ---------------------------------------------------------------------------

describe("buildStepList - force flag propagation", () => {
  it("seed:sprites gets forceFlag:true when --force passed", () => {
    const steps = buildStepList({ force: true, hasTtsKey: true });
    const sprite = steps.find((s) => s.script === "seed:sprites");
    expect(sprite.forceFlag).toBe(true);
  });

  it("seed:sprites gets forceFlag:false without --force", () => {
    const steps = buildStepList({ force: false, hasTtsKey: true });
    const sprite = steps.find((s) => s.script === "seed:sprites");
    expect(sprite.forceFlag).toBe(false);
  });

  it("seed step never gets forceFlag (it is always additive)", () => {
    const steps = buildStepList({ force: true, hasTtsKey: true });
    const seedStep = steps.find((s) => s.script === "seed");
    expect(seedStep.forceFlag).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatStepBanner
// ---------------------------------------------------------------------------

describe("formatStepBanner", () => {
  it("includes the step number and total", () => {
    const banner = formatStepBanner(0, 6, "Fetch species from PokéAPI");
    expect(banner).toContain("1/6");
  });

  it("includes the step name", () => {
    const banner = formatStepBanner(2, 6, "Optimise sprites");
    expect(banner).toContain("Optimise sprites");
  });

  it("pads single-digit indexes to match total width", () => {
    const banner = formatStepBanner(0, 10, "First step");
    // index 1, total 10: should be "01/10"
    expect(banner).toContain("01/10");
  });
});

// ---------------------------------------------------------------------------
// formatStepFailure
// ---------------------------------------------------------------------------

describe("formatStepFailure", () => {
  it("includes the script name", () => {
    const msg = formatStepFailure("seed:sprites", 1);
    expect(msg).toContain("seed:sprites");
  });

  it("includes the exit code", () => {
    const msg = formatStepFailure("seed", 2);
    expect(msg).toContain("2");
  });

  it("mentions re-running seed:all", () => {
    const msg = formatStepFailure("seed:split", 1);
    expect(msg).toContain("seed:all");
  });
});

// ---------------------------------------------------------------------------
// formatSuccess
// ---------------------------------------------------------------------------

describe("formatSuccess", () => {
  it("mentions no skips when skipped is 0", () => {
    const msg = formatSuccess(0);
    expect(msg).not.toContain("skipped");
  });

  it("mentions 1 step skipped when skipped is 1", () => {
    const msg = formatSuccess(1);
    expect(msg).toContain("1 step skipped");
  });

  it("uses plural when skipped > 1", () => {
    const msg = formatSuccess(2);
    expect(msg).toContain("2 steps skipped");
  });

  it("always advises reviewing the git diff", () => {
    const msg = formatSuccess(0);
    expect(msg).toContain("git diff");
  });
});
