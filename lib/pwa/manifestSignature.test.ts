/**
 * Fitness tests for the manifest signature helper (#1539).
 *
 * Per AGENTS.md "Every single-source helper ships with a forcing function":
 * these tests assert stability across calls and change-detection, ensuring
 * the signature is suitable for use as a persisted identity token.
 */

import { describe, it, expect } from "vitest";
import {
  computeManifestSignature,
  parseOfflineManifest,
  type OfflineManifest,
} from "./manifestSignature";
import { buildPrecacheUrls } from "./precache";
import { SEED_POKEMON } from "@/lib/pokemon/seed";

const ALL_OFFLINE_IDS: number[] = SEED_POKEMON.filter((p) => p.isDefaultForm).map((p) => p.id);

describe("computeManifestSignature", () => {
  it("returns a stable hex string for the same input", () => {
    const urls = buildPrecacheUrls(ALL_OFFLINE_IDS);
    const sig1 = computeManifestSignature(urls);
    const sig2 = computeManifestSignature(urls);
    expect(sig1).toBe(sig2);
  });

  it("returns a non-empty hex string", () => {
    const urls = buildPrecacheUrls(ALL_OFFLINE_IDS);
    const sig = computeManifestSignature(urls);
    expect(sig).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is stable regardless of input order (sorts internally)", () => {
    const urls = buildPrecacheUrls(ALL_OFFLINE_IDS);
    const reversed = [...urls].reverse();
    expect(computeManifestSignature(urls)).toBe(computeManifestSignature(reversed));
  });

  it("changes when the URL set changes (detects a new species ID)", () => {
    // Use a small subset, then add one ID.
    const base = ALL_OFFLINE_IDS.slice(0, 10);
    const extended = ALL_OFFLINE_IDS.slice(0, 11);
    const sigBase = computeManifestSignature(buildPrecacheUrls(base));
    const sigExtended = computeManifestSignature(buildPrecacheUrls(extended));
    expect(sigBase).not.toBe(sigExtended);
  });

  it("changes when the URL set changes (detects removal of a species ID)", () => {
    const base = ALL_OFFLINE_IDS.slice(0, 10);
    const smaller = ALL_OFFLINE_IDS.slice(0, 9);
    const sigBase = computeManifestSignature(buildPrecacheUrls(base));
    const sigSmaller = computeManifestSignature(buildPrecacheUrls(smaller));
    expect(sigBase).not.toBe(sigSmaller);
  });

  it("changes for different raw URL arrays even with same length", () => {
    // Build two URL lists from different ID slices of the same size.
    const a = buildPrecacheUrls(ALL_OFFLINE_IDS.slice(0, 5));
    const b = buildPrecacheUrls(ALL_OFFLINE_IDS.slice(5, 10));
    expect(computeManifestSignature(a)).not.toBe(computeManifestSignature(b));
  });

  it("returns a consistent value for an empty URL list", () => {
    const sig1 = computeManifestSignature([]);
    const sig2 = computeManifestSignature([]);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("parseOfflineManifest", () => {
  it("returns null for null input", () => {
    expect(parseOfflineManifest(null)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseOfflineManifest("{not json")).toBeNull();
  });

  it("returns null when signature is missing", () => {
    expect(parseOfflineManifest(JSON.stringify({ count: 100 }))).toBeNull();
  });

  it("returns null when count is missing", () => {
    expect(parseOfflineManifest(JSON.stringify({ signature: "abc123" }))).toBeNull();
  });

  it("returns null when count is negative", () => {
    expect(parseOfflineManifest(JSON.stringify({ signature: "abc", count: -1 }))).toBeNull();
  });

  it("returns null when count is non-finite", () => {
    expect(parseOfflineManifest(JSON.stringify({ signature: "abc", count: NaN }))).toBeNull();
  });

  it("parses a valid manifest", () => {
    const manifest: OfflineManifest = { signature: "deadbeef", count: 1025 };
    const result = parseOfflineManifest(JSON.stringify(manifest));
    expect(result).toEqual(manifest);
  });
});
