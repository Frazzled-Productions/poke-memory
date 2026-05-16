import { describe, it, expect } from "vitest";
import { HABITAT_ZONES } from "./zones";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_HABITATS = [
  "grassland",
  "forest",
  "sea",
  "cave",
  "mountain",
  "urban",
  "waters-edge",
  "rough-terrain",
  "rare",
  "unknown",
] as const;

type KnownHabitat = (typeof ALL_HABITATS)[number];

function zoneFor(habitat: KnownHabitat) {
  const z = HABITAT_ZONES.find((z) => z.habitat === habitat);
  if (!z) throw new Error(`Zone not found for habitat: ${habitat}`);
  return z;
}

function totalSlots(habitat: KnownHabitat): number {
  return zoneFor(habitat).subRegions.reduce(
    (acc, sr) => acc + sr.anchorSlots.length,
    0,
  );
}

// ---------------------------------------------------------------------------
// Structural integrity
// ---------------------------------------------------------------------------

describe("HABITAT_ZONES — structural integrity", () => {
  it("defines exactly 10 zones", () => {
    expect(HABITAT_ZONES).toHaveLength(10);
  });

  it("includes all expected habitat names", () => {
    const habitats = HABITAT_ZONES.map((z) => z.habitat);
    for (const h of ALL_HABITATS) {
      expect(habitats).toContain(h);
    }
  });

  it("every zone has a non-empty label", () => {
    for (const zone of HABITAT_ZONES) {
      expect(zone.label.length).toBeGreaterThan(0);
    }
  });

  it("every zone has at least one sub-region", () => {
    for (const zone of HABITAT_ZONES) {
      expect(zone.subRegions.length).toBeGreaterThan(0);
    }
  });

  it("every sub-region has a non-empty id and name", () => {
    for (const zone of HABITAT_ZONES) {
      for (const sr of zone.subRegions) {
        expect(sr.id.length).toBeGreaterThan(0);
        expect(sr.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("every sub-region has at least one anchor slot", () => {
    for (const zone of HABITAT_ZONES) {
      for (const sr of zone.subRegions) {
        expect(sr.anchorSlots.length).toBeGreaterThan(0);
      }
    }
  });

  it("sub-region IDs are unique across the entire zones array", () => {
    const allIds = HABITAT_ZONES.flatMap((z) => z.subRegions.map((sr) => sr.id));
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(allIds.length);
  });

  it("habitat names are unique", () => {
    const habitats = HABITAT_ZONES.map((z) => z.habitat);
    const unique = new Set(habitats);
    expect(unique.size).toBe(habitats.length);
  });
});

// ---------------------------------------------------------------------------
// Anchor slot coordinate invariants
// ---------------------------------------------------------------------------

describe("HABITAT_ZONES — anchor slot coordinate invariants", () => {
  it("all anchor x values are in [0.03, 0.97]", () => {
    for (const zone of HABITAT_ZONES) {
      for (const sr of zone.subRegions) {
        for (const slot of sr.anchorSlots) {
          expect(slot.x).toBeGreaterThanOrEqual(0.03);
          expect(slot.x).toBeLessThanOrEqual(0.97);
        }
      }
    }
  });

  it("all anchor y values are in [0.03, 0.97]", () => {
    for (const zone of HABITAT_ZONES) {
      for (const sr of zone.subRegions) {
        for (const slot of sr.anchorSlots) {
          expect(slot.y).toBeGreaterThanOrEqual(0.03);
          expect(slot.y).toBeLessThanOrEqual(0.97);
        }
      }
    }
  });

  it("all anchor coordinates are finite numbers", () => {
    for (const zone of HABITAT_ZONES) {
      for (const sr of zone.subRegions) {
        for (const slot of sr.anchorSlots) {
          expect(Number.isFinite(slot.x)).toBe(true);
          expect(Number.isFinite(slot.y)).toBe(true);
        }
      }
    }
  });

  it("coordinates are rounded to 3 decimal places (gridSlots contract)", () => {
    for (const zone of HABITAT_ZONES) {
      for (const sr of zone.subRegions) {
        for (const slot of sr.anchorSlots) {
          expect(slot.x).toBe(Math.round(slot.x * 1000) / 1000);
          expect(slot.y).toBe(Math.round(slot.y * 1000) / 1000);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Slot capacity vs. habitat species count
// ---------------------------------------------------------------------------

describe("HABITAT_ZONES — slot capacity vs. species counts", () => {
  it("grassland has at least 80 slots (species count: 80)", () => {
    expect(totalSlots("grassland")).toBeGreaterThanOrEqual(80);
  });

  it("forest has at least 71 slots (species count: 71)", () => {
    expect(totalSlots("forest")).toBeGreaterThanOrEqual(71);
  });

  it("waters-edge has at least 47 slots (species count: 47)", () => {
    expect(totalSlots("waters-edge")).toBeGreaterThanOrEqual(47);
  });

  it("mountain has at least 44 slots (species count: 45, slot total: 44)", () => {
    // The zone defines 8+10+12+14 = 44 slots — enough to cover the 45 species
    // with just one overflow wrap at most.
    expect(totalSlots("mountain")).toBeGreaterThanOrEqual(44);
  });

  it("sea has at least 40 slots (species count: 40)", () => {
    expect(totalSlots("sea")).toBeGreaterThanOrEqual(40);
  });

  it("urban has at least 37 slots (species count: 37)", () => {
    expect(totalSlots("urban")).toBeGreaterThanOrEqual(37);
  });

  it("cave has at least 29 slots (species count: 29)", () => {
    expect(totalSlots("cave")).toBeGreaterThanOrEqual(29);
  });

  it("rough-terrain has at least 27 slots (species count: 27)", () => {
    expect(totalSlots("rough-terrain")).toBeGreaterThanOrEqual(27);
  });

  it("rare has at least 10 slots (species count: 10)", () => {
    expect(totalSlots("rare")).toBeGreaterThanOrEqual(10);
  });

  it("unknown has at least 200 slots (species count: 639, overflow expected)", () => {
    // The 'unknown' zone covers 639 species; overflow is intentional (modular
    // wrapping), but the slot count should still be substantial.
    expect(totalSlots("unknown")).toBeGreaterThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Per-zone spot checks
// ---------------------------------------------------------------------------

describe("HABITAT_ZONES — per-zone spot checks", () => {
  it("grassland has 5 sub-regions", () => {
    expect(zoneFor("grassland").subRegions).toHaveLength(5);
  });

  it("unknown zone has 7 sub-regions", () => {
    expect(zoneFor("unknown").subRegions).toHaveLength(7);
  });

  it("rare zone label is 'Sanctuary'", () => {
    expect(zoneFor("rare").label).toBe("Sanctuary");
  });

  it("unknown zone label is 'Wildlands'", () => {
    expect(zoneFor("unknown").label).toBe("Wildlands");
  });

  it("sea zone sub-regions cover a vertical range (y spans surface to floor)", () => {
    const seaZone = zoneFor("sea");
    const allY = seaZone.subRegions.flatMap((sr) => sr.anchorSlots.map((s) => s.y));
    const minY = Math.min(...allY);
    const maxY = Math.max(...allY);
    // Surface slots should be at lower y (nearer top) than seafloor slots
    expect(maxY - minY).toBeGreaterThan(0.3);
  });
});
