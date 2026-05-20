import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NameReviewCard, ReviewableCard } from "@/lib/review/session";
import type { ReviewState } from "@/lib/srs/scheduler";
import { initialReviewState } from "@/lib/srs/scheduler";
import { KnownPokemonQuiz } from "@/components/onboarding/KnownPokemonQuiz";

// ────────────────────────────────────────────────────────────────────────────
// Stubs
// ────────────────────────────────────────────────────────────────────────────

// In-memory session stub. Tests mutate `currentSession`; loadSession returns
// the latest snapshot, saveSession overwrites it.
let currentSession: { cards: ReviewableCard[]; limits: unknown } | null = null;

vi.mock("@/lib/review/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/review/persistence")>(
    "@/lib/review/persistence",
  );
  return {
    ...actual,
    loadSession: vi.fn(async () => currentSession),
    saveSession: vi.fn(async (next: typeof currentSession) => {
      currentSession = next;
      return { ok: true } as const;
    }),
  };
});

// Default settings: 90% retention, no per-user weights.
vi.mock("@/lib/settings/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings/persistence")>(
    "@/lib/settings/persistence",
  );
  return {
    ...actual,
    loadSettings: vi.fn(() => ({
      ...actual.DEFAULT_SETTINGS,
      retentionTarget: 0.9,
    })),
  };
});

// Grade log: track each appended entry so the test can assert one log per
// graded card (the FSRS optimiser signal).
const appendedGradeEntries: Array<{
  date: string;
  grade: number;
  cardType: string;
  subjectKey?: string;
}> = [];

vi.mock("@/lib/gradelog/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gradelog/persistence")>(
    "@/lib/gradelog/persistence",
  );
  return {
    ...actual,
    appendGradeEntry: vi.fn(async (entry: { date: string; grade: number; cardType: string; subjectKey?: string }) => {
      appendedGradeEntries.push(entry);
      return { ...entry, occurredAt: Date.now() };
    }),
  };
});

// Stub the per-grade sync hook so we can verify enqueueGrade is called once
// per applied card without standing up a real Supabase client.
const enqueueGradeSpy = vi.fn();

vi.mock("@/lib/sync/usePerGradeSync", () => ({
  usePerGradeSync: () => ({
    enqueueGrade: enqueueGradeSpy,
    flushPending: () => [],
  }),
}));

// Bypass next/image — render a plain img so jsdom does not need an HTTP
// server for the sprite URLs.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ src, alt, ...rest }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...rest} />
  ),
}));

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-05-20T12:00:00Z");

function makeNameCard(
  id: number,
  name: string,
  state: ReviewState = initialReviewState(NOW),
): NameReviewCard {
  return {
    id,
    speciesId: id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: name,
    name,
    spriteUrl: `https://example.com/${id}.png`,
    types: ["normal"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "Test fixture.",
    flavorTexts: undefined,
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Test Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 1,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardType: "name",
    subjectKey: String(id),
    state,
  };
}

// jsdom does not implement HTMLDialogElement.showModal / close. Polyfill them
// so the bulk-confirm dialog mounts.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }

  appendedGradeEntries.length = 0;
  enqueueGradeSpy.mockClear();
  currentSession = null;
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("KnownPokemonQuiz", () => {
  it("shows an empty-state message when no eligible cards exist", async () => {
    currentSession = {
      cards: [
        makeNameCard(1, "Bulbasaur", {
          ...initialReviewState(NOW),
          lastReview: "2026-05-10",
          firstSeen: "2026-05-10",
          reps: 1,
        }),
      ],
      limits: {},
    };
    render(<KnownPokemonQuiz client={null} userId={null} superuserPaused={false} />);
    expect(
      await screen.findByText(/no new Pokémon left to mark/i),
    ).toBeInTheDocument();
  });

  it("renders eligible cards and lets the user toggle selection + apply", async () => {
    const user = userEvent.setup();
    currentSession = {
      cards: [
        makeNameCard(1, "Bulbasaur"),
        makeNameCard(2, "Ivysaur"),
      ],
      limits: { name: {}, evolution: {}, reverse: {}, cry: {} },
    };

    const onApplied = vi.fn();
    render(
      <KnownPokemonQuiz
        client={null}
        userId={null}
        superuserPaused={false}
        onApplied={onApplied}
      />,
    );

    // Wait for the grid to render.
    const tile = await screen.findByRole("checkbox", { name: /i already know Bulbasaur/i });
    expect(tile).toHaveAttribute("aria-checked", "false");

    // Tap to select.
    await user.click(tile);
    expect(tile).toHaveAttribute("aria-checked", "true");

    // The Apply button reflects the selection count.
    const applyBtn = screen.getByRole("button", { name: /Apply \(1 selected\)/ });
    await user.click(applyBtn);

    // After apply, the graded card should leave the eligibility list.
    await waitFor(() => {
      expect(
        screen.queryByRole("checkbox", { name: /i already know Bulbasaur/i }),
      ).not.toBeInTheDocument();
    });

    // A grade-log entry was emitted for the FSRS optimiser.
    expect(appendedGradeEntries).toHaveLength(1);
    expect(appendedGradeEntries[0]).toMatchObject({
      grade: 5,
      cardType: "name",
      subjectKey: "1",
    });

    // The graded card was queued for per-grade cloud upsert. enqueueGrade is
    // a no-op for null client/userId, but the call site still invokes it so
    // the sync surface is uniform.
    expect(enqueueGradeSpy).toHaveBeenCalledTimes(1);

    // The saved session reflects the graduated state.
    const persisted = currentSession!.cards.find((c) => c.id === 1)!;
    expect(persisted.state.lastReview).not.toBeNull();
    expect(persisted.state.reps).toBe(1);
    expect(persisted.state.scheduledDays).toBeGreaterThan(0);

    // Done callback received the count.
    expect(onApplied).toHaveBeenCalledWith(1);
  });

  it("opens a confirm dialog before marking all in a generation", async () => {
    const user = userEvent.setup();
    currentSession = {
      cards: [makeNameCard(1, "Bulbasaur"), makeNameCard(2, "Ivysaur")],
      limits: { name: {}, evolution: {}, reverse: {}, cry: {} },
    };

    render(<KnownPokemonQuiz client={null} userId={null} superuserPaused={false} />);

    // Wait for the grid.
    await screen.findByRole("checkbox", { name: /i already know Bulbasaur/i });

    const bulkBtn = screen.getByRole("button", { name: /mark all in this generation/i });
    await user.click(bulkBtn);

    // Confirm dialog appears.
    expect(
      screen.getByRole("heading", { name: /mark every Pokémon in Generation I/i }),
    ).toBeInTheDocument();

    // Cancel keeps the selection empty.
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      screen.getByRole("checkbox", { name: /i already know Bulbasaur/i }),
    ).toHaveAttribute("aria-checked", "false");

    // Re-open and confirm.
    await user.click(bulkBtn);
    await user.click(screen.getByRole("button", { name: /^mark all 2$/i }));

    // Both tiles are now selected.
    expect(
      screen.getByRole("checkbox", { name: /i already know Bulbasaur/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: /i already know Ivysaur/i }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("disables Apply with a superuser label when any flag is on", async () => {
    currentSession = {
      cards: [makeNameCard(1, "Bulbasaur")],
      limits: { name: {}, evolution: {}, reverse: {}, cry: {} },
    };

    render(<KnownPokemonQuiz client={null} userId={null} superuserPaused />);

    // Wait for the grid to render.
    await screen.findByRole("checkbox", { name: /i already know Bulbasaur/i });

    const pausedBtn = screen.getByRole("button", { name: /sync paused \(superuser\)/i });
    expect(pausedBtn).toBeDisabled();
  });

  it("excludes cards whose lastReview is already set (eligibility guard)", async () => {
    currentSession = {
      cards: [
        makeNameCard(1, "Bulbasaur"),
        makeNameCard(2, "Ivysaur", {
          ...initialReviewState(NOW),
          lastReview: "2026-05-10",
          firstSeen: "2026-05-10",
          reps: 1,
        }),
      ],
      limits: { name: {}, evolution: {}, reverse: {}, cry: {} },
    };

    render(<KnownPokemonQuiz client={null} userId={null} superuserPaused={false} />);

    // Bulbasaur (eligible) is shown; Ivysaur (already touched) is not.
    expect(
      await screen.findByRole("checkbox", { name: /i already know Bulbasaur/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /i already know Ivysaur/i }),
    ).not.toBeInTheDocument();
  });
});
