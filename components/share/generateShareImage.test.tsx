/**
 * Tests for the canvas-based share image generator.
 * Lives under components/ (not lib/) because it calls document.createElement
 * and needs the jsdom environment.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateDailyShareImage,
  generateMilestoneShareImage,
} from "@/lib/share/generateShareImage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Install a mock <canvas> that resolves toBlob with a valid PNG-typed Blob. */
function mockCanvasToBlob(blob: Blob | null) {
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      const canvas = originalCreate("canvas") as HTMLCanvasElement;
      // getContext returns a minimal stub with all methods as no-ops.
      canvas.getContext = (() => {
        const ctx = {
          scale: vi.fn(),
          fillStyle: "",
          strokeStyle: "",
          lineWidth: 0,
          font: "",
          textBaseline: "",
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          arcTo: vi.fn(),
          arc: vi.fn(),
          closePath: vi.fn(),
          fill: vi.fn(),
          stroke: vi.fn(),
          fillRect: vi.fn(),
          fillText: vi.fn(),
        };
        return ctx;
      }) as unknown as typeof canvas.getContext;
      canvas.toBlob = (cb: (b: Blob | null) => void) => {
        // Call asynchronously to match the real browser behaviour.
        Promise.resolve().then(() => cb(blob));
      };
      return canvas;
    }
    return originalCreate(tag);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// generateDailyShareImage
// ---------------------------------------------------------------------------

describe("generateDailyShareImage", () => {
  it("returns null when canvas.getContext returns null (no 2d support)", async () => {
    // jsdom's default canvas.getContext always returns null, so this
    // exercises the null-guard in the generator.
    const result = await generateDailyShareImage({
      date: "2026-05-12",
      streak: 7,
      reviewed: 24,
      newCards: 6,
      mastered: 2,
      gradeSequence: [4, 5, 4, 1],
    });
    expect(result).toBeNull();
  });

  it("returns a Blob when canvas renders successfully", async () => {
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    mockCanvasToBlob(expectedBlob);

    const result = await generateDailyShareImage({
      date: "2026-05-12",
      streak: 7,
      reviewed: 24,
      newCards: 6,
      mastered: 2,
      gradeSequence: [4, 5, 4, 1],
    });
    expect(result).toBe(expectedBlob);
  });

  it("returns null when toBlob yields null (e.g. security restriction)", async () => {
    mockCanvasToBlob(null);

    const result = await generateDailyShareImage({
      date: "2026-05-12",
      streak: 0,
      reviewed: 5,
      newCards: 1,
      mastered: 0,
      gradeSequence: [4],
    });
    expect(result).toBeNull();
  });

  it("accepts an empty gradeSequence without throwing", async () => {
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    mockCanvasToBlob(expectedBlob);

    const result = await generateDailyShareImage({
      date: "2026-05-12",
      streak: 0,
      reviewed: 0,
      newCards: 0,
      mastered: 0,
      gradeSequence: [],
    });
    expect(result).toBe(expectedBlob);
  });
});

// ---------------------------------------------------------------------------
// generateMilestoneShareImage
// ---------------------------------------------------------------------------

describe("generateMilestoneShareImage", () => {
  it("returns null when canvas.getContext returns null", async () => {
    const result = await generateMilestoneShareImage({
      label: "100 Pokémon mastered",
      shareText: "I've mastered 100 Pokémon!",
    });
    expect(result).toBeNull();
  });

  it("returns a Blob when canvas renders successfully", async () => {
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    mockCanvasToBlob(expectedBlob);

    const result = await generateMilestoneShareImage({
      label: "100 Pokémon mastered",
      shareText: "I've mastered 100 Pokémon!",
    });
    expect(result).toBe(expectedBlob);
  });
});
