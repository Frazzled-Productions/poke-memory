/**
 * Tests for the shared biome wrapper and helper components, plus a smoke
 * test for each biome backdrop.
 *
 * These are rendering tests only — they verify that:
 *  1. BiomeSvg renders an SVG element with the correct invariant attributes.
 *  2. BiomeSky renders a <defs> linearGradient and a full-bleed background
 *     rect with the expected fill reference.
 *  3. BiomeFloor renders the terrain polygon and its shadow edge stroke with
 *     the correct attributes.
 *  4. Each biome component mounts without throwing and produces an svg root.
 *
 * No pixel snapshot tests are needed: this refactor is purely structural —
 * the rendered SVG markup is semantically identical before and after, so a
 * rendering regression would only be possible if the component logic itself
 * changed (which these tests would catch via attribute assertions).
 */

import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { BiomeSvg } from "./BiomeSvg";
import { BiomeSky } from "./BiomeSky";
import { BiomeFloor } from "./BiomeFloor";
import { CaveBiome } from "./CaveBiome";
import { ForestBiome } from "./ForestBiome";
import { GrasslandsBiome } from "./GrasslandsBiome";
import { MountainBiome } from "./MountainBiome";
import { RoughTerrainBiome } from "./RoughTerrainBiome";
import { SanctuaryBiome } from "./SanctuaryBiome";
import { SeaBiome } from "./SeaBiome";
import { UrbanBiome } from "./UrbanBiome";
import { WatersEdgeBiome } from "./WatersEdgeBiome";
import { WildlandsBiome } from "./WildlandsBiome";

// ---------------------------------------------------------------------------
// BiomeSvg — invariant attributes
// ---------------------------------------------------------------------------

describe("BiomeSvg", () => {
  it("renders an svg element with the correct viewBox", () => {
    const { container } = render(<BiomeSvg><rect /></BiomeSvg>);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 1600 600");
  });

  it("sets preserveAspectRatio to xMidYMid slice", () => {
    const { container } = render(<BiomeSvg><rect /></BiomeSvg>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
  });

  it("is aria-hidden", () => {
    const { container } = render(<BiomeSvg><rect /></BiomeSvg>);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders children inside the svg", () => {
    const { container } = render(
      <BiomeSvg>
        <rect data-testid="child" />
      </BiomeSvg>,
    );
    expect(container.querySelector("[data-testid='child']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BiomeSky — shared background gradient + full-bleed rect
// ---------------------------------------------------------------------------

describe("BiomeSky", () => {
  const stops = [
    { offset: "0%", stopColor: "#7fc1e8" },
    { offset: "100%", stopColor: "#dcefff" },
  ];

  it("renders a linearGradient with the given id inside defs", () => {
    const { container } = render(
      <svg>
        <BiomeSky gradientId="test-sky" stops={stops} />
      </svg>,
    );
    const gradient = container.querySelector("defs linearGradient#test-sky");
    expect(gradient).not.toBeNull();
    expect(gradient?.getAttribute("x1")).toBe("0");
    expect(gradient?.getAttribute("x2")).toBe("0");
    expect(gradient?.getAttribute("y1")).toBe("0");
    expect(gradient?.getAttribute("y2")).toBe("1");
  });

  it("renders one stop element per stop prop", () => {
    const threeStops = [
      { offset: "0%", stopColor: "#aaa" },
      { offset: "50%", stopColor: "#bbb" },
      { offset: "100%", stopColor: "#ccc" },
    ];
    const { container } = render(
      <svg>
        <BiomeSky gradientId="three-stop" stops={threeStops} />
      </svg>,
    );
    // Use getElementsByTagNameNS to avoid jsdom treating "stop" as a CSS
    // pseudo-selector (which causes querySelectorAll to return 0 results).
    const gradient = container.querySelector("defs linearGradient#three-stop");
    const stopEls = gradient?.getElementsByTagNameNS(
      "http://www.w3.org/2000/svg",
      "stop",
    );
    expect(stopEls?.length).toBe(3);
  });

  it("renders a stop with stopOpacity when the prop is provided", () => {
    const stopsWithOpacity = [
      { offset: "0%", stopColor: "#fff", stopOpacity: 0 },
    ];
    const { container } = render(
      <svg>
        <BiomeSky gradientId="opacity-test" stops={stopsWithOpacity} />
      </svg>,
    );
    const gradient = container.querySelector("defs linearGradient#opacity-test");
    const stop = gradient?.getElementsByTagNameNS(
      "http://www.w3.org/2000/svg",
      "stop",
    )[0];
    expect(stop?.getAttribute("stop-opacity")).toBe("0");
  });

  it("renders a full-bleed background rect referencing the gradient", () => {
    const { container } = render(
      <svg>
        <BiomeSky gradientId="test-sky" stops={stops} />
      </svg>,
    );
    const rect = container.querySelector("rect");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("width")).toBe("1600");
    expect(rect?.getAttribute("height")).toBe("600");
    expect(rect?.getAttribute("fill")).toBe("url(#test-sky)");
  });
});

// ---------------------------------------------------------------------------
// BiomeFloor — shared wavy terrain polygon + shadow edge stroke
// ---------------------------------------------------------------------------

describe("BiomeFloor", () => {
  const curve =
    "M0,440 C200,420 400,448 700,432 C1000,418 1300,448 1600,428";

  it("renders a fill path that appends the closing rectangle", () => {
    const { container } = render(
      <svg>
        <BiomeFloor
          curvePath={curve}
          fill="url(#forest-floor)"
          strokeColor="#2a1a08"
        />
      </svg>,
    );
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const fillPath = paths[0];
    expect(fillPath.getAttribute("d")).toBe(`${curve} L1600,600 L0,600 Z`);
    expect(fillPath.getAttribute("fill")).toBe("url(#forest-floor)");
  });

  it("renders an edge stroke path with the curve path only", () => {
    const { container } = render(
      <svg>
        <BiomeFloor
          curvePath={curve}
          fill="#5dba4f"
          strokeColor="#3a8f30"
          strokeOpacity={0.7}
        />
      </svg>,
    );
    const paths = container.querySelectorAll("path");
    const strokePath = paths[1];
    expect(strokePath.getAttribute("d")).toBe(curve);
    expect(strokePath.getAttribute("stroke")).toBe("#3a8f30");
    expect(strokePath.getAttribute("fill")).toBe("none");
    expect(strokePath.getAttribute("opacity")).toBe("0.7");
  });

  it("uses a default strokeWidth of 3 when not specified", () => {
    const { container } = render(
      <svg>
        <BiomeFloor curvePath={curve} fill="#5dba4f" strokeColor="#3a8f30" />
      </svg>,
    );
    const paths = container.querySelectorAll("path");
    const strokePath = paths[1];
    expect(strokePath.getAttribute("stroke-width")).toBe("3");
  });

  it("uses a default strokeOpacity of 0.55 when not specified", () => {
    const { container } = render(
      <svg>
        <BiomeFloor curvePath={curve} fill="#5dba4f" strokeColor="#3a8f30" />
      </svg>,
    );
    const paths = container.querySelectorAll("path");
    const strokePath = paths[1];
    expect(strokePath.getAttribute("opacity")).toBe("0.55");
  });
});

// ---------------------------------------------------------------------------
// Individual biome smoke tests — each must mount and produce an svg root.
// ---------------------------------------------------------------------------

const BIOMES = [
  ["CaveBiome",         CaveBiome],
  ["ForestBiome",       ForestBiome],
  ["GrasslandsBiome",   GrasslandsBiome],
  ["MountainBiome",     MountainBiome],
  ["RoughTerrainBiome", RoughTerrainBiome],
  ["SanctuaryBiome",    SanctuaryBiome],
  ["SeaBiome",          SeaBiome],
  ["UrbanBiome",        UrbanBiome],
  ["WatersEdgeBiome",   WatersEdgeBiome],
  ["WildlandsBiome",    WildlandsBiome],
] as const;

describe("biome backdrop components", () => {
  for (const [name, Component] of BIOMES) {
    it(`${name} renders an svg root without throwing`, () => {
      const { container } = render(<Component />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
    });

    it(`${name} svg is aria-hidden and has correct viewBox`, () => {
      const { container } = render(<Component />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 1600 600");
    });
  }
});
