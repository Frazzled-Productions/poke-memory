import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { SettingsSearch } from "@/components/settings/SettingsSearch";
import {
  SETTINGS_SEARCH_INDEX,
  sectionMatchesQuery,
  type SectionSearchEntry,
} from "@/components/settings/settingsSearchIndex";

// ---------------------------------------------------------------------------
// SettingsSearch component tests
// ---------------------------------------------------------------------------

describe("SettingsSearch", () => {
  it("renders a search input", () => {
    const onChange = vi.fn();
    render(<SettingsSearch value="" onChange={onChange} matchCount={5} />);
    expect(screen.getByRole("searchbox", { name: /search settings/i })).toBeInTheDocument();
  });

  it("calls onChange when the user types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SettingsSearch value="" onChange={onChange} matchCount={5} />);

    await user.type(screen.getByRole("searchbox"), "audio");
    expect(onChange).toHaveBeenCalled();
    // The last call should contain the final character typed.
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1][0]).toBe("o");
  });

  it("does not show clear button when query is empty", () => {
    render(<SettingsSearch value="" onChange={vi.fn()} matchCount={5} />);
    expect(screen.queryByRole("button", { name: /clear search/i })).toBeNull();
  });

  it("shows a clear button when there is a non-empty query", () => {
    render(<SettingsSearch value="audio" onChange={vi.fn()} matchCount={1} />);
    expect(screen.getByRole("button", { name: /clear search/i })).toBeInTheDocument();
  });

  it("calls onChange with empty string when the clear button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SettingsSearch value="audio" onChange={onChange} matchCount={1} />);

    await user.click(screen.getByRole("button", { name: /clear search/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("announces plural match count to screen readers when query is non-empty", () => {
    render(<SettingsSearch value="audio" onChange={vi.fn()} matchCount={2} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("2 sections match your search.");
  });

  it("announces singular match count correctly", () => {
    render(<SettingsSearch value="audio" onChange={vi.fn()} matchCount={1} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("1 section matches your search.");
  });

  it("announces zero matches correctly", () => {
    render(<SettingsSearch value="zzznomatch" onChange={vi.fn()} matchCount={0} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No settings match your search.");
  });

  it("does not announce when query is empty", () => {
    render(<SettingsSearch value="" onChange={vi.fn()} matchCount={5} />);
    const status = screen.getByRole("status");
    // Status region exists but has no meaningful text.
    expect(status.textContent?.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// sectionMatchesQuery unit tests
// ---------------------------------------------------------------------------

describe("sectionMatchesQuery", () => {
  const entry: SectionSearchEntry = {
    sectionId: "test-section",
    terms: ["audio", "cry", "voice", "text to speech"],
  };

  it("returns true for empty query (no filter)", () => {
    expect(sectionMatchesQuery(entry, "")).toBe(true);
  });

  it("matches a term exactly", () => {
    expect(sectionMatchesQuery(entry, "cry")).toBe(true);
  });

  it("matches a substring of a term", () => {
    expect(sectionMatchesQuery(entry, "tex")).toBe(true);
  });

  it("matches case-insensitively when caller passes a lower-cased query", () => {
    // sectionMatchesQuery expects a pre-normalised (lower-cased) query —
    // the settings page normalises via .trim().toLowerCase() before calling it.
    expect(sectionMatchesQuery(entry, "audio")).toBe(true);
  });

  it("returns false when no term matches", () => {
    expect(sectionMatchesQuery(entry, "backup")).toBe(false);
  });

  it("matches multi-word aliases as a substring", () => {
    expect(sectionMatchesQuery(entry, "to speech")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SETTINGS_SEARCH_INDEX coverage checks
// ---------------------------------------------------------------------------

describe("SETTINGS_SEARCH_INDEX", () => {
  const sectionIds = SETTINGS_SEARCH_INDEX.map((e) => e.sectionId);

  it("contains all five top-level section ids", () => {
    expect(sectionIds).toContain("appearance-heading");
    expect(sectionIds).toContain("practice-heading");
    expect(sectionIds).toContain("audio-heading");
    expect(sectionIds).toContain("account-data-heading");
    expect(sectionIds).toContain("advanced-heading");
  });

  it("'dark mode' matches Appearance section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "appearance-heading")!;
    expect(sectionMatchesQuery(entry, "dark mode")).toBe(true);
  });

  it("'fsrs' matches Practice section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "practice-heading")!;
    expect(sectionMatchesQuery(entry, "fsrs")).toBe(true);
  });

  it("'alternate forms' matches Practice section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "practice-heading")!;
    expect(sectionMatchesQuery(entry, "alternate forms")).toBe(true);
  });

  it("'tts' matches Audio section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "audio-heading")!;
    expect(sectionMatchesQuery(entry, "tts")).toBe(true);
  });

  it("'backup' matches Account & Data section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "account-data-heading")!;
    expect(sectionMatchesQuery(entry, "backup")).toBe(true);
  });

  it("'danger zone' matches Advanced section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "advanced-heading")!;
    expect(sectionMatchesQuery(entry, "danger zone")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Settings page filter logic (visible-section derivation)
// Consolidates the tests that were previously in SettingsSearchFilter.test.tsx.
// ---------------------------------------------------------------------------

/** Simulates the visibleSectionIds derivation from the settings page. */
function getVisibleSectionIds(query: string): Set<string> {
  const normalised = query.trim().toLowerCase();
  return new Set(
    SETTINGS_SEARCH_INDEX
      .filter((entry) => sectionMatchesQuery(entry, normalised))
      .map((entry) => entry.sectionId),
  );
}

describe("Settings page filter logic", () => {
  it("returns all 5 sections when query is empty", () => {
    const visible = getVisibleSectionIds("");
    expect(visible.size).toBe(5);
    for (const id of ["appearance-heading", "practice-heading", "audio-heading", "account-data-heading", "advanced-heading"]) {
      expect(visible.has(id)).toBe(true);
    }
  });

  it("returns all 5 sections when query is whitespace-only", () => {
    expect(getVisibleSectionIds("   ").size).toBe(5);
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
    expect(getVisibleSectionIds("xyzzynosuchthing").size).toBe(0);
  });

  it("is case-insensitive — 'BACKUP' matches Account & Data", () => {
    expect(getVisibleSectionIds("BACKUP").has("account-data-heading")).toBe(true);
  });

  it("clearing the query restores all 5 sections", () => {
    expect(getVisibleSectionIds("cry").size).toBe(1);
    expect(getVisibleSectionIds("").size).toBe(5);
  });

  it("'voice' matches only Audio", () => {
    const visible = getVisibleSectionIds("voice");
    expect(visible.has("audio-heading")).toBe(true);
    expect(visible.size).toBe(1);
  });
});
