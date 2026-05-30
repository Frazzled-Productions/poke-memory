import { describe, it, expect } from "vitest";
import {
  sectionLabel,
  sectionLabelSm,
  sectionLabelSubtle,
  sectionLabelSmSubtle,
  dialogPanel,
  statValue,
  cardPanel,
  cardPanelPadded,
  colStack,
  colStackLg,
  chartTickText,
  mutedText,
} from "./class-names";

describe("class-names constants", () => {
  describe("sectionLabel", () => {
    it("is a non-empty string", () => {
      expect(typeof sectionLabel).toBe("string");
      expect(sectionLabel.length).toBeGreaterThan(0);
    });

    it("matches the expected literal", () => {
      expect(sectionLabel).toBe(
        "text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400",
      );
    });
  });

  describe("sectionLabelSm", () => {
    it("is a non-empty string", () => {
      expect(typeof sectionLabelSm).toBe("string");
      expect(sectionLabelSm.length).toBeGreaterThan(0);
    });

    it("matches the expected literal", () => {
      expect(sectionLabelSm).toBe(
        "text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400",
      );
    });
  });

  describe("sectionLabelSubtle", () => {
    it("is a non-empty string", () => {
      expect(typeof sectionLabelSubtle).toBe("string");
      expect(sectionLabelSubtle.length).toBeGreaterThan(0);
    });

    it("matches the expected literal", () => {
      expect(sectionLabelSubtle).toBe(
        "text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500",
      );
    });
  });

  describe("sectionLabelSmSubtle", () => {
    it("is a non-empty string", () => {
      expect(typeof sectionLabelSmSubtle).toBe("string");
      expect(sectionLabelSmSubtle.length).toBeGreaterThan(0);
    });

    it("matches the expected literal", () => {
      expect(sectionLabelSmSubtle).toBe(
        "text-sm font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500",
      );
    });
  });

  describe("dialogPanel", () => {
    it("is a non-empty string", () => {
      expect(typeof dialogPanel).toBe("string");
      expect(dialogPanel.length).toBeGreaterThan(0);
    });

    it("matches the expected literal", () => {
      expect(dialogPanel).toBe(
        "rounded-xl border border-zinc-200 bg-background p-6 shadow-xl backdrop:bg-black/50 dark:border-zinc-800",
      );
    });
  });

  describe("statValue", () => {
    it("is a non-empty string", () => {
      expect(typeof statValue).toBe("string");
      expect(statValue.length).toBeGreaterThan(0);
    });

    it("matches the expected literal", () => {
      expect(statValue).toBe("tabular-nums text-zinc-600 dark:text-zinc-300");
    });
  });

  // Smoke-check existing constants to guard against accidental edits.
  it("cardPanel is a non-empty string", () => {
    expect(typeof cardPanel).toBe("string");
    expect(cardPanel.length).toBeGreaterThan(0);
  });

  it("cardPanelPadded is a non-empty string", () => {
    expect(typeof cardPanelPadded).toBe("string");
    expect(cardPanelPadded.length).toBeGreaterThan(0);
  });

  it("colStack is a non-empty string", () => {
    expect(typeof colStack).toBe("string");
    expect(colStack.length).toBeGreaterThan(0);
  });

  it("colStackLg is a non-empty string", () => {
    expect(typeof colStackLg).toBe("string");
    expect(colStackLg.length).toBeGreaterThan(0);
  });

  it("chartTickText is a non-empty string", () => {
    expect(typeof chartTickText).toBe("string");
    expect(chartTickText.length).toBeGreaterThan(0);
  });

  it("mutedText is a non-empty string", () => {
    expect(typeof mutedText).toBe("string");
    expect(mutedText.length).toBeGreaterThan(0);
  });
});
