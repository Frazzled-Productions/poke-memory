import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
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
    renderWithIntl(<SettingsSearch value="" onChange={onChange} matchCount={5} />);
    expect(screen.getByRole("searchbox", { name: /search settings/i })).toBeInTheDocument();
  });

  it("calls onChange when the user types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithIntl(<SettingsSearch value="" onChange={onChange} matchCount={5} />);

    await user.type(screen.getByRole("searchbox"), "audio");
    expect(onChange).toHaveBeenCalled();
    // The last call should contain the final character typed.
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1][0]).toBe("o");
  });

  it("does not show clear button when query is empty", () => {
    renderWithIntl(<SettingsSearch value="" onChange={vi.fn()} matchCount={5} />);
    expect(screen.queryByRole("button", { name: /clear search/i })).toBeNull();
  });

  it("shows a clear button when there is a non-empty query", () => {
    renderWithIntl(<SettingsSearch value="audio" onChange={vi.fn()} matchCount={1} />);
    expect(screen.getByRole("button", { name: /clear search/i })).toBeInTheDocument();
  });

  it("calls onChange with empty string when the clear button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithIntl(<SettingsSearch value="audio" onChange={onChange} matchCount={1} />);

    await user.click(screen.getByRole("button", { name: /clear search/i }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("announces plural match count to screen readers when query is non-empty", () => {
    renderWithIntl(<SettingsSearch value="audio" onChange={vi.fn()} matchCount={2} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("2 sections match your search.");
  });

  it("announces singular match count correctly", () => {
    renderWithIntl(<SettingsSearch value="audio" onChange={vi.fn()} matchCount={1} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("1 section matches your search.");
  });

  it("announces zero matches correctly", () => {
    renderWithIntl(<SettingsSearch value="zzznomatch" onChange={vi.fn()} matchCount={0} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("No settings match your search.");
  });

  it("does not announce when query is empty", () => {
    renderWithIntl(<SettingsSearch value="" onChange={vi.fn()} matchCount={5} />);
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
    // sectionMatchesQuery expects a pre-normalised (lower-cased) query - 
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

  it("contains all ten top-level section ids", () => {
    expect(sectionIds).toContain("practice-schedule-heading");
    expect(sectionIds).toContain("card-types-heading");
    expect(sectionIds).toContain("audio-heading");
    expect(sectionIds).toContain("language-heading");
    expect(sectionIds).toContain("appearance-heading");
    expect(sectionIds).toContain("offline-heading");
    expect(sectionIds).toContain("regional-reminders-heading");
    expect(sectionIds).toContain("data-backup-heading");
    expect(sectionIds).toContain("about-heading");
    expect(sectionIds).toContain("advanced-heading");
  });

  it("'dark mode' matches Appearance section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "appearance-heading")!;
    expect(sectionMatchesQuery(entry, "dark mode")).toBe(true);
  });

  it("'fsrs' matches Practice schedule section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "practice-schedule-heading")!;
    expect(sectionMatchesQuery(entry, "fsrs")).toBe(true);
  });

  it("'alternate forms' matches Card types section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "card-types-heading")!;
    expect(sectionMatchesQuery(entry, "alternate forms")).toBe(true);
  });

  it("'tts' matches Audio section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "audio-heading")!;
    expect(sectionMatchesQuery(entry, "tts")).toBe(true);
  });

  it("'backup' matches Data & backup section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "data-backup-heading")!;
    expect(sectionMatchesQuery(entry, "backup")).toBe(true);
  });

  it("'danger zone' matches Advanced section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "advanced-heading")!;
    expect(sectionMatchesQuery(entry, "danger zone")).toBe(true);
  });

  it("'japanese' matches Language section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "language-heading")!;
    expect(sectionMatchesQuery(entry, "japanese")).toBe(true);
  });

  it("native-script query '日本語' also matches Language section (#1726 AC)", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "language-heading")!;
    // sectionMatchesQuery receives a pre-normalised query; the native-script
    // term is already in the index so no additional lowercasing is needed.
    expect(sectionMatchesQuery(entry, "日本語")).toBe(true);
  });

  it("'timezone' matches Regional & reminders section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "regional-reminders-heading")!;
    expect(sectionMatchesQuery(entry, "timezone")).toBe(true);
  });

  it("'cry cards' matches Card types section", () => {
    const entry = SETTINGS_SEARCH_INDEX.find((e) => e.sectionId === "card-types-heading")!;
    expect(sectionMatchesQuery(entry, "cry cards")).toBe(true);
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
  it("returns all 10 sections when query is empty", () => {
    const visible = getVisibleSectionIds("");
    expect(visible.size).toBe(10);
    for (const id of [
      "practice-schedule-heading",
      "card-types-heading",
      "audio-heading",
      "language-heading",
      "appearance-heading",
      "offline-heading",
      "regional-reminders-heading",
      "data-backup-heading",
      "about-heading",
      "advanced-heading",
    ]) {
      expect(visible.has(id)).toBe(true);
    }
  });

  it("returns all 10 sections when query is whitespace-only", () => {
    expect(getVisibleSectionIds("   ").size).toBe(10);
  });

  it("filters to Audio and Card types when query is 'cry'", () => {
    const visible = getVisibleSectionIds("cry");
    // "cry" now matches both Audio (play cry on reveal) and Card types (cry cards).
    expect(visible.has("audio-heading")).toBe(true);
    expect(visible.has("card-types-heading")).toBe(true);
    expect(visible.has("appearance-heading")).toBe(false);
    expect(visible.has("practice-schedule-heading")).toBe(false);
    expect(visible.has("advanced-heading")).toBe(false);
  });

  it("filters to only Practice schedule when query is 'recall'", () => {
    const visible = getVisibleSectionIds("recall");
    expect(visible.has("practice-schedule-heading")).toBe(true);
    expect(visible.has("audio-heading")).toBe(false);
  });

  it("filters to only Regional & reminders when query is 'timezone'", () => {
    const visible = getVisibleSectionIds("timezone");
    expect(visible.has("regional-reminders-heading")).toBe(true);
    expect(visible.has("practice-schedule-heading")).toBe(false);
    expect(visible.has("data-backup-heading")).toBe(false);
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

  it("is case-insensitive - 'BACKUP' matches Data & backup", () => {
    expect(getVisibleSectionIds("BACKUP").has("data-backup-heading")).toBe(true);
  });

  it("clearing the query restores all 10 sections", () => {
    expect(getVisibleSectionIds("voice").size).toBe(1);
    expect(getVisibleSectionIds("").size).toBe(10);
  });

  it("'voice' matches only Audio", () => {
    const visible = getVisibleSectionIds("voice");
    expect(visible.has("audio-heading")).toBe(true);
    expect(visible.size).toBe(1);
  });

  it("'japanese' matches only Language", () => {
    const visible = getVisibleSectionIds("japanese");
    expect(visible.has("language-heading")).toBe(true);
    expect(visible.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SettingsSearch - Japanese locale (#1392)
//
// Verifies that the aria strings (clear button, aria-live announcements)
// are localised in the Japanese catalogue and not hardcoded English.
// ---------------------------------------------------------------------------

describe("SettingsSearch - Japanese locale aria strings", () => {
  it("renders the clear button with a Japanese aria-label", () => {
    renderJa(<SettingsSearch value="test" onChange={vi.fn()} matchCount={1} />);
    // The Japanese catalog key clearAriaLabel must produce a non-English label.
    const clearBtn = screen.getByRole("button");
    expect(clearBtn).toBeInTheDocument();
    const label = clearBtn.getAttribute("aria-label") ?? "";
    // Must not be the English string.
    expect(label).not.toBe("Clear search");
    // Must be a non-empty string (the Japanese translation).
    expect(label.length).toBeGreaterThan(0);
  });

  it("announces zero matches in Japanese", () => {
    renderJa(
      <SettingsSearch value="zzznomatch" onChange={vi.fn()} matchCount={0} />,
    );
    const status = screen.getByRole("status");
    // Must not be the English hardcoded string.
    expect(status.textContent).not.toBe("No settings match your search.");
    // Must be non-empty (the Japanese translation).
    expect((status.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("announces plural match count in Japanese", () => {
    renderJa(
      <SettingsSearch value="audio" onChange={vi.fn()} matchCount={2} />,
    );
    const status = screen.getByRole("status");
    expect((status.textContent ?? "").trim().length).toBeGreaterThan(0);
    // Must not contain English words.
    expect(status.textContent).not.toMatch(/section/);
  });
});
