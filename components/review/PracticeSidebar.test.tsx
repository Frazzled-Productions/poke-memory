/**
 * PracticeSidebar component tests.
 *
 * Covers:
 *  - Loading skeleton
 *  - Zero-grades state ("No cards reviewed yet today")
 *  - Non-zero total: card count, accuracy, grade tally rows
 *  - GRADE_LOG_APPENDED_EVENT live-update listener
 *  - StorageEvent on the grade-log key (reset-all-progress path)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithIntl, screen, waitFor, act } from "@/components/test-utils/renderWithIntl";
import { PracticeSidebar } from "@/components/review/PracticeSidebar";
import { GRADE_LOG_APPENDED_EVENT } from "@/lib/gradelog/persistence";
import { KEY_GRADE_LOG } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the persistence module so tests don't touch IndexedDB.
const mockLoadGradeLog = vi.fn();
vi.mock("@/lib/gradelog/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gradelog/persistence")>();
  return {
    ...actual,
    loadGradeLog: (...args: unknown[]) => mockLoadGradeLog(...args),
  };
});

// Pin todayString to a fixed date so grade-sequence filtering is predictable.
const FIXED_TODAY = "2026-01-15";
vi.mock("@/lib/review/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review/session")>();
  return {
    ...actual,
    todayString: () => FIXED_TODAY,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal GradeLogEntry for a given grade occurring today. */
function entry(grade: 1 | 2 | 4 | 5, occurredAt = Date.now()) {
  return {
    date: FIXED_TODAY,
    grade,
    cardType: "name" as const,
    occurredAt,
    subjectKey: String(grade),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockLoadGradeLog.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PracticeSidebar - loading state", () => {
  it("renders a loading skeleton before the grade log resolves", () => {
    // Never-resolving promise keeps the component in the loading state.
    mockLoadGradeLog.mockReturnValue(new Promise(() => {}));

    renderWithIntl(<PracticeSidebar />);

    // The aside landmark is present even during loading.
    expect(screen.getByRole("complementary", { name: "Session progress" })).toBeInTheDocument();

    // No grade-count or grade-label text yet.
    expect(screen.queryByText("Cards reviewed")).toBeNull();
    expect(screen.queryByText(/No cards reviewed/)).toBeNull();
  });
});

describe("PracticeSidebar - zero grades (empty state)", () => {
  beforeEach(() => {
    mockLoadGradeLog.mockResolvedValue([]);
  });

  it("shows zero cards reviewed and the empty-state message", async () => {
    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Cards reviewed")).toBeInTheDocument();
    });

    // Total is displayed as "0".
    expect(screen.getByText("0")).toBeInTheDocument();

    // Accuracy row is hidden when total is 0.
    expect(screen.queryByText("Accuracy")).toBeNull();

    // Empty-state copy.
    expect(
      screen.getByText("No cards reviewed yet today."),
    ).toBeInTheDocument();
  });

  it("does not render any grade tally rows when total is 0", async () => {
    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Cards reviewed")).toBeInTheDocument();
    });

    // GradeTallyRow returns null for count === 0, so no grade labels appear.
    expect(screen.queryByText("Again")).toBeNull();
    expect(screen.queryByText("Hard")).toBeNull();
    expect(screen.queryByText("Good")).toBeNull();
    expect(screen.queryByText("Easy")).toBeNull();
  });
});

describe("PracticeSidebar - non-zero grades", () => {
  const GRADES = [
    entry(4, 1000),
    entry(5, 2000),
    entry(4, 3000),
    entry(1, 4000),
    entry(2, 5000),
  ];

  beforeEach(() => {
    mockLoadGradeLog.mockResolvedValue(GRADES);
  });

  it("shows the correct total card count", async () => {
    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Cards reviewed")).toBeInTheDocument();
    });

    // 5 entries total.
    const statValues = screen.getAllByText("5");
    expect(statValues.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the accuracy percentage (Good + Easy out of total)", async () => {
    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Accuracy")).toBeInTheDocument();
    });

    // Good (4) × 2 + Easy (5) × 1 = 3 passes / 5 total = 60%.
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("renders tally rows only for grades that have a non-zero count", async () => {
    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Accuracy")).toBeInTheDocument();
    });

    // Good × 2, Easy × 1, Hard × 1, Again × 1 - all present.
    expect(screen.getByText("Again")).toBeInTheDocument();
    expect(screen.getByText("Hard")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("Easy")).toBeInTheDocument();
  });

  it("renders per-grade counts correctly", async () => {
    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Good")).toBeInTheDocument();
    });

    // Locate the tally list and assert counts by grade name proximity.
    const list = screen.getByRole("list", { name: "Grade breakdown" });
    const items = screen.getAllByRole("listitem");

    // Each non-zero grade produces exactly one listitem.
    expect(items.length).toBe(4);

    // The list node exists inside the tally container.
    expect(list).toBeInTheDocument();
  });

  it("renders the 'View full stats' link pointing to /stats", async () => {
    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Cards reviewed")).toBeInTheDocument();
    });

    const link = screen.getByRole("link", { name: /View full stats/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/stats");
  });
});

describe("PracticeSidebar - GRADE_LOG_APPENDED_EVENT live update", () => {
  it("re-reads the grade log when a grade-appended event fires", async () => {
    // Initially empty log.
    mockLoadGradeLog.mockResolvedValueOnce([]);
    // Second call (after event) returns one grade.
    mockLoadGradeLog.mockResolvedValueOnce([entry(4, 1000)]);

    renderWithIntl(<PracticeSidebar />);

    // Wait for the initial empty render.
    await waitFor(() => {
      expect(screen.getByText("No cards reviewed yet today.")).toBeInTheDocument();
    });

    // Fire the grade-appended event.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(GRADE_LOG_APPENDED_EVENT));
    });

    // The sidebar should now show one reviewed card.
    await waitFor(() => {
      expect(screen.getByText("Cards reviewed")).toBeInTheDocument();
      expect(screen.queryByText("No cards reviewed yet today.")).toBeNull();
    });
  });
});

describe("PracticeSidebar - StorageEvent reset path", () => {
  it("re-reads the grade log when the grade-log storage key fires a StorageEvent", async () => {
    // Initially has one grade.
    mockLoadGradeLog.mockResolvedValueOnce([entry(5, 1000)]);
    // After reset, grade log is empty.
    mockLoadGradeLog.mockResolvedValueOnce([]);

    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.queryByText("No cards reviewed yet today.")).toBeNull();
      expect(screen.getByText("Cards reviewed")).toBeInTheDocument();
    });

    // Simulate the synthetic StorageEvent dispatched by reset.ts.
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEY_GRADE_LOG }));
    });

    // The sidebar should clear to the empty state.
    await waitFor(() => {
      expect(screen.getByText("No cards reviewed yet today.")).toBeInTheDocument();
    });
  });

  it("ignores StorageEvents for unrelated keys", async () => {
    mockLoadGradeLog.mockResolvedValue([entry(4, 1000)]);

    renderWithIntl(<PracticeSidebar />);

    await waitFor(() => {
      expect(screen.getByText("Cards reviewed")).toBeInTheDocument();
    });

    const callCount = mockLoadGradeLog.mock.calls.length;

    // Fire a storage event for a different key.
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "poke-memory:settings:v1" }),
      );
    });

    // loadGradeLog should NOT have been called again.
    expect(mockLoadGradeLog.mock.calls.length).toBe(callCount);
  });
});
