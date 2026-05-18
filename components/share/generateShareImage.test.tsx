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

/** Minimal CanvasRenderingContext2D stub for the new card painter. */
function makeCtxStub() {
  return {
    scale: vi.fn(),
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    strokeStyle: "" as string | CanvasGradient | CanvasPattern,
    lineWidth: 0,
    font: "",
    textBaseline: "" as CanvasTextBaseline,
    textAlign: "" as CanvasTextAlign,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
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
    createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
    save: vi.fn(),
    restore: vi.fn(),
  };
}

/** Install a mock <canvas> that resolves toBlob with the given Blob (or null). */
function mockCanvasToBlob(blob: Blob | null) {
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      const canvas = originalCreate("canvas") as HTMLCanvasElement;
      // Stub getContext so the painter does not throw.
      canvas.getContext = (() =>
        makeCtxStub()) as unknown as typeof canvas.getContext;
      canvas.toBlob = (cb: (b: Blob | null) => void) => {
        // Call asynchronously to match real browser behaviour.
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

  it("renders with zero streak and all-zero stats without throwing", async () => {
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

  it("streak 0: does not throw and produces a Blob", async () => {
    // When streak is 0 the hero switches to reviewed count + "CARDS TODAY".
    // Verify the generator completes without error.
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    mockCanvasToBlob(expectedBlob);

    const result = await generateDailyShareImage({
      date: "2026-05-18",
      streak: 0,
      reviewed: 12,
      newCards: 3,
      mastered: 1,
      gradeSequence: [4, 4, 5],
    });
    expect(result).toBe(expectedBlob);
  });

  it("produces a canvas sized 1200×1440 (600×720 logical at 2×)", async () => {
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    const originalCreate = document.createElement.bind(document);
    let capturedCanvas: HTMLCanvasElement | null = null;

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "canvas") {
        capturedCanvas = el as HTMLCanvasElement;
        capturedCanvas.getContext = (() =>
          makeCtxStub()) as unknown as typeof capturedCanvas.getContext;
        capturedCanvas.toBlob = (cb: (b: Blob | null) => void) => {
          Promise.resolve().then(() => cb(expectedBlob));
        };
      }
      return el;
    });

    await generateDailyShareImage({
      date: "2026-05-12",
      streak: 5,
      reviewed: 10,
      newCards: 2,
      mastered: 1,
      gradeSequence: [],
    });

    expect(capturedCanvas).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(capturedCanvas!.width).toBe(1200);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(capturedCanvas!.height).toBe(1440);
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

  it("returns null when toBlob yields null", async () => {
    mockCanvasToBlob(null);

    const result = await generateMilestoneShareImage({
      label: "Generation I complete!",
      shareText: "Mastered all Gen I Pokémon!",
    });
    expect(result).toBeNull();
  });

  it("produces a canvas sized 1200×1440 (600×720 logical at 2×)", async () => {
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    const originalCreate = document.createElement.bind(document);
    let capturedCanvas: HTMLCanvasElement | null = null;

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "canvas") {
        capturedCanvas = el as HTMLCanvasElement;
        capturedCanvas.getContext = (() =>
          makeCtxStub()) as unknown as typeof capturedCanvas.getContext;
        capturedCanvas.toBlob = (cb: (b: Blob | null) => void) => {
          Promise.resolve().then(() => cb(expectedBlob));
        };
      }
      return el;
    });

    await generateMilestoneShareImage({
      label: "100 Pokémon mastered",
      shareText: "I've mastered 100!",
    });

    expect(capturedCanvas).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(capturedCanvas!.width).toBe(1200);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(capturedCanvas!.height).toBe(1440);
  });
});
