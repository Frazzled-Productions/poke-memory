/**
 * Component tests for PastureBiomeStats — locale coverage (#1393).
 *
 * Verifies that the sr-only ARIA labels are sourced from the catalogue and
 * render the correct values in English and Japanese.
 */

import { describe, it, expect } from "vitest";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
import { PastureBiomeStats } from "./PastureBiomeStats";
import type { BiomeStats } from "@/lib/pasture/stats";

const STATS: BiomeStats = {
  masteredCount: 5,
  totalCount: 10,
  capturedPercent: 50,
  latestAddition: "Pikachu",
};

const STATS_NO_LATEST: BiomeStats = {
  masteredCount: 0,
  totalCount: 5,
  capturedPercent: 0,
  latestAddition: null,
};

describe("PastureBiomeStats — English (default)", () => {
  it("renders the Biome statistics aria-label in en locale", () => {
    const { container } = renderWithIntl(<PastureBiomeStats stats={STATS} />);
    expect(container.querySelector('[aria-label="Biome statistics"]')).toBeInTheDocument();
  });

  it("renders the Mastered sr-only label in en locale", () => {
    renderWithIntl(<PastureBiomeStats stats={STATS} />);
    expect(screen.getByText("Mastered")).toBeInTheDocument();
  });

  it("renders the Captured sr-only label in en locale", () => {
    renderWithIntl(<PastureBiomeStats stats={STATS} />);
    expect(screen.getByText("Captured")).toBeInTheDocument();
  });

  it("renders the Latest addition sr-only label when latestAddition is present", () => {
    renderWithIntl(<PastureBiomeStats stats={STATS} />);
    expect(screen.getByText("Latest addition")).toBeInTheDocument();
  });

  it("does not render Latest addition when latestAddition is null", () => {
    renderWithIntl(<PastureBiomeStats stats={STATS_NO_LATEST} />);
    expect(screen.queryByText("Latest addition")).not.toBeInTheDocument();
  });
});

describe("PastureBiomeStats — Japanese locale coverage (mandatory #1393)", () => {
  it("renders the Japanese biome statistics aria-label in ja locale", () => {
    const { container } = renderJa(<PastureBiomeStats stats={STATS} />);
    // ja pasture.biomeStats.ariaLabel = "バイオーム統計"
    expect(container.querySelector('[aria-label="バイオーム統計"]')).toBeInTheDocument();
  });

  it("renders the Japanese Mastered sr-only label in ja locale", () => {
    renderJa(<PastureBiomeStats stats={STATS} />);
    // ja pasture.biomeStats.mastered = "習得済み"
    expect(screen.getByText("習得済み")).toBeInTheDocument();
  });

  it("renders the Japanese Captured sr-only label in ja locale", () => {
    renderJa(<PastureBiomeStats stats={STATS} />);
    // ja pasture.biomeStats.captured = "捕獲済み"
    expect(screen.getByText("捕獲済み")).toBeInTheDocument();
  });

  it("renders the Japanese Latest addition sr-only label in ja locale", () => {
    renderJa(<PastureBiomeStats stats={STATS} />);
    // ja pasture.biomeStats.latestAddition = "最新追加"
    expect(screen.getByText("最新追加")).toBeInTheDocument();
  });
});
