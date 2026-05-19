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
    // paintDisc() calls measureText to read actualBoundingBoxAscent as the
    // cap height of the hero number glyph. Returning 0 triggers the calibrated
    // fallback (0.72 x numFontSize) inside paintDisc().
    measureText: vi.fn().mockReturnValue({ actualBoundingBoxAscent: 0 }),
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

  // -------------------------------------------------------------------------
  // Vertical centring tests.
  //
  // paintDisc() centres the combined number+label block on disc centre cy.
  // When measureText returns 0, the fallback cap-height ratio is used:
  //   capHeight = numFontSize * 0.72
  //
  // Disc centre (daily card, stats present):
  //   cy = ((54+23+16+12) + (720-(1.5+28+60+22+54))) / 2 = 329.75
  //
  // Expected fillText Y coords:
  //   numBaseline = cy - (capHeight + labelGap + 23) / 2 + capHeight
  //   labelTop    = numBaseline + labelGap
  // -------------------------------------------------------------------------
  it.each([
    ["7", 208],
    ["42", 208],
    ["100", 160],
    ["1000", 140],
  ] as [string, number][])(
    "hero '%s' (numFontSize=%i): number+label block is vertically centred on disc cy",
    async (heroNumber: string, numFontSize: number) => {
      const expectedBlob = new Blob(["png"], { type: "image/png" });
      const originalCreate = document.createElement.bind(document);
      let capturedCtx: ReturnType<typeof makeCtxStub> | null = null;

      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = originalCreate(tag);
        if (tag === "canvas") {
          const canvas = el as HTMLCanvasElement;
          capturedCtx = makeCtxStub(); // measureText returns 0 -> fallback ratio
          canvas.getContext = (() =>
            capturedCtx) as unknown as typeof canvas.getContext;
          canvas.toBlob = (cb: (b: Blob | null) => void) => {
            Promise.resolve().then(() => cb(expectedBlob));
          };
        }
        return el;
      });

      await generateDailyShareImage({
        date: "2026-05-12",
        streak: Number(heroNumber),
        reviewed: 10,
        newCards: 2,
        mastered: 1,
        gradeSequence: [],
      });

      expect(capturedCtx).not.toBeNull();

      const cy = 329.75;
      const capHeight = numFontSize * 0.72;
      const labelGap = Math.max(12, numFontSize * 0.1);
      const labelH = 23;
      const blockHeight = capHeight + labelGap + labelH;
      const expectedNumBaseline = cy - blockHeight / 2 + capHeight;
      const expectedLabelTop = expectedNumBaseline + labelGap;

      const calls = capturedCtx!.fillText.mock.calls as [
        string,
        number,
        number,
      ][];
      const numCall = calls.find((c) => c[0] === heroNumber);
      const labelCall = calls.find((c) => c[0] === "DAY STREAK");

      expect(numCall).toBeDefined();
      expect(labelCall).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(numCall![2]).toBeCloseTo(expectedNumBaseline, 0);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(labelCall![2]).toBeCloseTo(expectedLabelTop, 0);
    },
  );

  it("hero number uses measured cap height when measureText returns non-zero actualBoundingBoxAscent", async () => {
    const measuredCapHeight = 140;
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    const originalCreate = document.createElement.bind(document);
    let capturedCtx: ReturnType<typeof makeCtxStub> | null = null;

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "canvas") {
        const canvas = el as HTMLCanvasElement;
        capturedCtx = makeCtxStub();
        capturedCtx.measureText.mockReturnValue({
          actualBoundingBoxAscent: measuredCapHeight,
        });
        canvas.getContext = (() =>
          capturedCtx) as unknown as typeof canvas.getContext;
        canvas.toBlob = (cb: (b: Blob | null) => void) => {
          Promise.resolve().then(() => cb(expectedBlob));
        };
      }
      return el;
    });

    await generateDailyShareImage({
      date: "2026-05-12",
      streak: 7,
      reviewed: 10,
      newCards: 2,
      mastered: 1,
      gradeSequence: [],
    });

    expect(capturedCtx).not.toBeNull();

    const cy = 329.75;
    const numFontSize = 208;
    const labelGap = Math.max(12, numFontSize * 0.1);
    const labelH = 23;
    const blockHeight = measuredCapHeight + labelGap + labelH;
    const expectedNumBaseline = cy - blockHeight / 2 + measuredCapHeight;
    const expectedLabelTop = expectedNumBaseline + labelGap;

    const calls = capturedCtx!.fillText.mock.calls as [string, number, number][];
    const numCall = calls.find((c) => c[0] === "7");
    const labelCall = calls.find((c) => c[0] === "DAY STREAK");

    expect(numCall).toBeDefined();
    expect(labelCall).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(numCall![2]).toBeCloseTo(expectedNumBaseline, 0);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(labelCall![2]).toBeCloseTo(expectedLabelTop, 0);
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

  it("strips leading number so fillText receives 'POKÉMON MASTERED', not '100 POKÉMON MASTERED'", async () => {
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    const originalCreate = document.createElement.bind(document);
    let capturedCtx: ReturnType<typeof makeCtxStub> | null = null;

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "canvas") {
        const canvas = el as HTMLCanvasElement;
        capturedCtx = makeCtxStub();
        canvas.getContext = (() =>
          capturedCtx) as unknown as typeof canvas.getContext;
        canvas.toBlob = (cb: (b: Blob | null) => void) => {
          Promise.resolve().then(() => cb(expectedBlob));
        };
      }
      return el;
    });

    await generateMilestoneShareImage({
      label: "100 Pokémon mastered",
      shareText: "I've mastered 100 Pokémon!",
    });

    expect(capturedCtx).not.toBeNull();
    const textArgs = capturedCtx!.fillText.mock.calls.map(
      (c: unknown[]) => c[0]
    );
    expect(textArgs).toContain("POKÉMON MASTERED");
    expect(textArgs).not.toContain("100 POKÉMON MASTERED");
  });

  it("renders without error when accent has low contrast (covers rgba ring-colour path)", async () => {
    // When the accent colour has contrast < 3:1 vs DISC_FILL (#111113),
    // ringColour() returns "rgba(255,255,255,0.92)" instead of the accent.
    // ringColourHex() then parses the rgba components (lines 206–208).
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        name === "--theme-accent" ? "#050505" : "",
    } as unknown as CSSStyleDeclaration);

    const expectedBlob = new Blob(["png"], { type: "image/png" });
    mockCanvasToBlob(expectedBlob);

    const result = await generateMilestoneShareImage({
      label: "50 Pokémon mastered",
      shareText: "Mastered 50!",
    });
    expect(result).toBe(expectedBlob);
  });

  it("handles comma-formatted milestone numbers (e.g. '1,000 Pokémon mastered')", async () => {
    const expectedBlob = new Blob(["png"], { type: "image/png" });
    const originalCreate = document.createElement.bind(document);
    let capturedCtx: ReturnType<typeof makeCtxStub> | null = null;

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "canvas") {
        const canvas = el as HTMLCanvasElement;
        capturedCtx = makeCtxStub();
        canvas.getContext = (() =>
          capturedCtx) as unknown as typeof canvas.getContext;
        canvas.toBlob = (cb: (b: Blob | null) => void) => {
          Promise.resolve().then(() => cb(expectedBlob));
        };
      }
      return el;
    });

    await generateMilestoneShareImage({
      label: "1,000 Pokémon mastered",
      shareText: "I've mastered 1,000 Pokémon!",
    });

    expect(capturedCtx).not.toBeNull();
    const textArgs = capturedCtx!.fillText.mock.calls.map(
      (c: unknown[]) => c[0]
    );
    expect(textArgs).toContain("1,000");
    expect(textArgs).toContain("POKÉMON MASTERED");
  });
});
