/**
 * Tests for the Settings page search/filter behaviour using a lightweight
 * stand-in for the full page — we test the filtering logic directly via the
 * search-index helpers rather than mounting the full page (which requires
 * ~15 mocked modules).
 *
 * The full-page filter wiring is exercised by the E2E tests in
 * e2e/settings.spec.ts.
 */
import { describe, it, expect } from "vitest";
import {
  SETTINGS_SEARCH_INDEX,
  sectionMatchesQuery,
} from "@/components/settings/settingsSearchIndex";

/**
 * Simulates the visibleSectionIds derivation from the settings page.
 * Returns the set of sectionIds that are visible for a given query.
 */
function getVisibleSectionIds(query: string): Set<string> {
  const normalised = query.trim().toLowerCase();
  return new Set(
    SETTINGS_SEARCH_INDEX
      .filter((entry) => sectionMatchesQuery(entry, normalised))
      .map((entry) => entry.sectionId),
  );
}

describe("Settings page search filter logic", () => {
  it("returns all 5 sections when query is empty", () => {
    const visible = getVisibleSectionIds("");
    expect(visible.size).toBe(5);
    expect(visible.has("appearance-heading")).toBe(true);
    expect(visible.has("practice-heading")).toBe(true);
    expect(visible.has("audio-heading")).toBe(true);
    expect(visible.has("account-data-heading")).toBe(true);
    expect(visible.has("advanced-heading")).toBe(true);
  });

  it("returns all 5 sections when query is whitespace-only", () => {
    const visible = getVisibleSectionIds("   ");
    expect(visible.size).toBe(5);
  });

  it("filters to only Audio when query is 'cry'", () => {
    const visible = getVisibleSectionIds("cry");
    expect(visible.has("audio-heading")).toBe(true);
    expect(visible.has("appearance-heading")).toBe(false);
    expect(visible.has("practice-heading")).toBe(false);
    expect(visible.has("account-data-heading")).toBe(false);
    expect(visible.has("advanced-heading")).toBe(false);
  });

  it("filters to only Practice when query is 'recall'", () => {
    const visible = getVisibleSectionIds("recall");
    expect(visible.has("practice-heading")).toBe(true);
    expect(visible.has("audio-heading")).toBe(false);
  });

  it("filters to only Account & Data when query is 'timezone'", () => {
    const visible = getVisibleSectionIds("timezone");
    expect(visible.has("account-data-heading")).toBe(true);
    expect(visible.has("practice-heading")).toBe(false);
  });

  it("filters to only Advanced when query is 'danger'", () => {
    const visible = getVisibleSectionIds("danger");
    expect(visible.has("advanced-heading")).toBe(true);
    expect(visible.has("appearance-heading")).toBe(false);
    expect(visible.has("audio-heading")).toBe(false);
  });

  it("returns an empty set for a query that matches nothing", () => {
    const visible = getVisibleSectionIds("xyzzynosuchthing");
    expect(visible.size).toBe(0);
  });

  it("is case-insensitive — 'BACKUP' matches Account & Data", () => {
    const visible = getVisibleSectionIds("BACKUP");
    expect(visible.has("account-data-heading")).toBe(true);
  });

  it("clearing the query (empty string) restores all 5 sections", () => {
    // Simulate: filter applied, then cleared.
    const filtered = getVisibleSectionIds("cry");
    expect(filtered.size).toBe(1);

    const restored = getVisibleSectionIds("");
    expect(restored.size).toBe(5);
  });

  it("'alternate forms' matches Practice and only Practice", () => {
    const visible = getVisibleSectionIds("alternate forms");
    expect(visible.has("practice-heading")).toBe(true);
    expect(visible.size).toBe(1);
  });

  it("'voice' matches only Audio", () => {
    const visible = getVisibleSectionIds("voice");
    expect(visible.has("audio-heading")).toBe(true);
    expect(visible.size).toBe(1);
  });
});
