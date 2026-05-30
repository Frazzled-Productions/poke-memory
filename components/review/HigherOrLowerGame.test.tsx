import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HigherOrLowerGame } from "@/components/review/HigherOrLowerGame";
import type { SeedPokemon } from "@/lib/pokemon/seed";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const { mockSaveSettings, mockLoadSettings } = vi.hoisted(() => ({
  mockSaveSettings: vi.fn(),
  mockLoadSettings: vi.fn(),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
}));

// pickPair and shufflePair are mocked to return deterministic pairs so tests
// don't depend on Math.random. We fix left=Bulbasaur, right=Ivysaur, stat="attack".
// Bulbasaur attack=49, Ivysaur attack=100 → right is higher.
const { mockPickPair, mockShufflePair } = vi.hoisted(() => ({
  mockPickPair: vi.fn(),
  mockShufflePair: vi.fn(),
}));

vi.mock("@/lib/minigame/higherOrLower", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minigame/higherOrLower")>();
  return {
    ...actual,
    pickPair: (...args: Parameters<typeof actual.pickPair>) => mockPickPair(...args),
    // shufflePair is tracked via mockShufflePair so tests can assert call
    // counts. Position randomisation is covered by unit tests in
    // lib/minigame/higherOrLower.test.ts.
    shufflePair: (pair: ReturnType<typeof actual.pickPair>) => mockShufflePair(pair),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePokemon(overrides: Partial<SeedPokemon> & Pick<SeedPokemon, "id" | "name">): SeedPokemon {
  return {
    speciesId: overrides.id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: overrides.name,
    spriteUrl: `https://example.com/${overrides.name.toLowerCase()}.png`,
    types: ["normal"],
    stats: { hp: 50, attack: 50, defense: 50, specialAttack: 50, specialDefense: 50, speed: 50 },
    flavorText: "A test Pokémon.",
    flavorTexts: ["A test Pokémon."],
    evolutionChain: [],
    height: null,
    weight: null,
    baseExperience: null,
    genus: null,
    generation: null,
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    ...overrides,
  };
}

const BULBASAUR = makePokemon({
  id: 1,
  name: "Bulbasaur",
  stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
});

const IVYSAUR = makePokemon({
  id: 2,
  name: "Ivysaur",
  stats: { hp: 60, attack: 100, defense: 63, specialAttack: 80, specialDefense: 80, speed: 60 },
});

const SEEN: SeedPokemon[] = [BULBASAUR, IVYSAUR];

// Fixed pair: right (Ivysaur) has higher attack.
const FIXED_PAIR = { left: BULBASAUR, right: IVYSAUR, stat: "attack" as const };

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadSettings.mockReturnValue({ miniGameBestScore: 0 });
  mockPickPair.mockReturnValue(FIXED_PAIR);
  // shufflePair is a passthrough in tests — just return the pair unchanged.
  mockShufflePair.mockImplementation((pair: typeof FIXED_PAIR) => pair);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HigherOrLowerGame", () => {
  it("renders both Pokémon names and the stat prompt", () => {
    render(<HigherOrLowerGame seenPokemon={SEEN} />);

    expect(screen.getByRole("button", { name: "Bulbasaur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ivysaur" })).toBeInTheDocument();
    expect(screen.getByText(/which has higher/i)).toBeInTheDocument();
    expect(screen.getByText("Attack")).toBeInTheDocument();
  });

  it("increments streak to 1 and shows result banner after clicking the higher-stat button", async () => {
    const user = userEvent.setup();
    render(<HigherOrLowerGame seenPokemon={SEEN} />);

    // Ivysaur has the higher attack — clicking it is the correct choice.
    await user.click(screen.getByRole("button", { name: "Ivysaur" }));

    expect(screen.getByText(/correct/i)).toBeInTheDocument();
    // The streak counter label and value span are siblings; match the parent span text.
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Streak: 1"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next pair/i })).toBeInTheDocument();
  });

  it("shows Game over message and resets streak after clicking the lower-stat button", async () => {
    const user = userEvent.setup();
    render(<HigherOrLowerGame seenPokemon={SEEN} />);

    // Bulbasaur has the lower attack — clicking it is wrong.
    await user.click(screen.getByRole("button", { name: "Bulbasaur" }));

    expect(screen.getByText(/game over/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();

    // Clicking "Play again" resets the streak counter.
    await user.click(screen.getByRole("button", { name: /play again/i }));

    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Streak: 0"),
    ).toBeInTheDocument();
    // The next pair prompt should be visible again.
    expect(screen.getByText(/which has higher/i)).toBeInTheDocument();
  });

  it("persists new best immediately on the correct guess that sets it — not deferred to Play again", async () => {
    const user = userEvent.setup();
    render(<HigherOrLowerGame seenPokemon={SEEN} />);

    // Correct pick: streak becomes 1, which beats bestScore of 0.
    await user.click(screen.getByRole("button", { name: "Ivysaur" }));

    // saveSettings must have fired already — before the user clicks anything else.
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ miniGameBestScore: 1 }),
    );
    // Best counter updates immediately in the UI.
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Best: 1"),
    ).toBeInTheDocument();
  });

  it("persists new best on correct guess and preserves it after Play again resets streak", async () => {
    const user = userEvent.setup();
    render(<HigherOrLowerGame seenPokemon={SEEN} />);

    // Build a streak of 1.
    await user.click(screen.getByRole("button", { name: "Ivysaur" }));
    await user.click(screen.getByRole("button", { name: /next pair/i }));

    // Pick wrong to trigger game-over.
    await user.click(screen.getByRole("button", { name: "Bulbasaur" }));

    // saveSettings was called when the correct guess was made, not now.
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ miniGameBestScore: 1 }),
    );

    // Play again resets the streak but must not call saveSettings a second time.
    const callCount = mockSaveSettings.mock.calls.length;
    await user.click(screen.getByRole("button", { name: /play again/i }));
    expect(mockSaveSettings.mock.calls.length).toBe(callCount);

    // Streak resets but best is preserved in the UI.
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Streak: 0"),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Best: 1"),
    ).toBeInTheDocument();
  });

  it("does not call saveSettings when a correct guess does not beat the existing best", async () => {
    mockLoadSettings.mockReturnValue({ miniGameBestScore: 5 });
    const user = userEvent.setup();
    render(<HigherOrLowerGame seenPokemon={SEEN} />);

    // Correct pick: streak becomes 1, which is less than bestScore of 5.
    await user.click(screen.getByRole("button", { name: "Ivysaur" }));

    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("does not call saveSettings on a wrong answer that does not surpass the best", async () => {
    mockLoadSettings.mockReturnValue({ miniGameBestScore: 5 });
    const user = userEvent.setup();
    render(<HigherOrLowerGame seenPokemon={SEEN} />);

    // Immediately pick wrong — streak of 0 never beats bestScore of 5.
    await user.click(screen.getByRole("button", { name: "Bulbasaur" }));

    expect(mockSaveSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /play again/i }));

    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("shows the tie banner and advances without resetting streak on a tie", async () => {
    const tied = makePokemon({
      id: 99,
      name: "Tieface",
      stats: { hp: 49, attack: 49, defense: 49, specialAttack: 49, specialDefense: 49, speed: 49 },
    });
    mockPickPair.mockReturnValue({ left: BULBASAUR, right: tied, stat: "attack" as const });

    const user = userEvent.setup();
    render(<HigherOrLowerGame seenPokemon={[BULBASAUR, tied]} />);

    await user.click(screen.getByRole("button", { name: "Tieface" }));

    expect(screen.getByText(/equal, both count/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next pair/i })).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Streak: 1"),
    ).toBeInTheDocument();
  });

  it("returns null when fewer than 2 Pokémon are provided", () => {
    const { container } = render(<HigherOrLowerGame seenPokemon={[BULBASAUR]} />);
    expect(container.firstChild).toBeNull();
  });

  describe("idempotent initialisation (#887 — re-show does not clobber game state)", () => {
    // The `if (pair) return;` guard in the pair-seeding useEffect makes
    // initialisation idempotent. The effect has `[pair]` as its dep array, so
    // it fires twice on mount: once when pair is null (seeds the pair) and once
    // when pair transitions null → value. The guard exits early on that second
    // run so pickPair/shufflePair are only called once total. Without the guard
    // both runs would sample a new pair (count 2), silently resetting game state.
    //
    // These tests verify that by asserting call counts. They WILL fail if the
    // `if (pair) return;` guard is deleted (count becomes 2 instead of 1),
    // unlike a rerender()-based approach which is vacuous because rerender()
    // with unchanged props does not re-trigger a [pair] effect.

    it("calls pickPair and shufflePair exactly once on mount even though the [pair] effect fires twice", async () => {
      render(<HigherOrLowerGame seenPokemon={SEEN} />);

      // Wait for the pair to render — confirms both effect runs have completed.
      expect(await screen.findByRole("button", { name: "Bulbasaur" })).toBeInTheDocument();

      // Guard holds: each sampler called once despite the effect firing twice
      // (pair: null → FIXED_PAIR → [guard exits]). Deleting the guard yields 2.
      expect(mockPickPair).toHaveBeenCalledTimes(1);
      expect(mockShufflePair).toHaveBeenCalledTimes(1);
    });

    it("keeps game-over phase intact when the pair-seeding effect re-runs after a loss", async () => {
      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={SEEN} />);

      // Wait for pair to render (both effect runs have settled), then pick wrong.
      expect(await screen.findByRole("button", { name: "Bulbasaur" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Bulbasaur" }));
      expect(screen.getByText(/game over/i)).toBeInTheDocument();

      // Guard verification: exactly one sampling call happened during mount.
      // Removing the guard would yield 2 here, and game state would have been
      // clobbered by the second sampling run before the user even interacted.
      expect(mockPickPair).toHaveBeenCalledTimes(1);
      expect(mockShufflePair).toHaveBeenCalledTimes(1);

      // Semantic check: the guard-protected state is preserved.
      expect(screen.getByText(/game over/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
    });

    it("does not reload bestScore from storage on re-show, preserving in-session high score", async () => {
      // The stored best starts at 0.
      mockLoadSettings.mockReturnValue({ miniGameBestScore: 0 });
      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={SEEN} />);

      // Wait for pair to render (both effect runs have settled).
      expect(await screen.findByRole("button", { name: "Ivysaur" })).toBeInTheDocument();

      // Guard verification: loadSettings called exactly once (the guard blocks
      // the second effect run from re-reading it). Removing the guard yields 2.
      expect(mockLoadSettings).toHaveBeenCalledTimes(1);

      // Make a correct pick — streak=1 beats bestScore=0 so it is updated in-state.
      await user.click(screen.getByRole("button", { name: "Ivysaur" }));
      expect(
        screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Best: 1"),
      ).toBeInTheDocument();

      // In-session best (1) must still be shown — loadSettings was not re-read
      // on the second effect run (which would have returned 0 and overwritten it).
      expect(mockPickPair).toHaveBeenCalledTimes(1);
      expect(mockShufflePair).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Best: 1"),
      ).toBeInTheDocument();
    });
  });

  describe("sprite-decode-before-swap", () => {
    // These tests install a controlled `window.Image` whose `decode()` resolves
    // on demand so we can assert that the pair does not swap until after decode.

    let originalImage: typeof window.Image;
    let resolveDecodes: (() => void)[];

    beforeEach(() => {
      originalImage = window.Image;
      resolveDecodes = [];

      // Replace window.Image with a constructor that exposes a decode() method
      // backed by a manually-resolvable promise.
      window.Image = class FakeImage {
        src = "";
        decode() {
          return new Promise<void>((resolve) => {
            resolveDecodes.push(resolve);
          });
        }
      } as unknown as typeof window.Image;
    });

    afterEach(() => {
      window.Image = originalImage;
    });

    it("does not swap the pair until sprite decode resolves", async () => {
      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={SEEN} />);

      // Make a correct pick to reveal the result and show "Next pair".
      await user.click(screen.getByRole("button", { name: "Ivysaur" }));
      expect(screen.getByRole("button", { name: /next pair/i })).toBeInTheDocument();

      // Click "Next pair" — decode is now pending.
      await user.click(screen.getByRole("button", { name: /next pair/i }));

      // The "Next pair" button should be disabled while decode is in-flight.
      expect(screen.getByRole("button", { name: /next pair/i })).toBeDisabled();

      // The result banner should still be visible (pair hasn't swapped yet).
      expect(screen.getByText(/correct/i)).toBeInTheDocument();

      // Resolve all pending decodes.
      resolveDecodes.forEach((resolve) => resolve());

      // Wait for React to flush the deferred state update.
      await vi.waitFor(() => {
        expect(screen.queryByText(/correct/i)).toBeNull();
      });

      // After decode resolves the game should be back in picking phase.
      expect(screen.getByText(/which has higher/i)).toBeInTheDocument();
    });

    it("keeps the correct streak value in the game-over banner while Play again decode is in-flight", async () => {
      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={SEEN} />);

      // Build a streak of 1 with a correct pick, then advance to the next pair.
      await user.click(screen.getByRole("button", { name: "Ivysaur" }));
      // Resolve the first decode (triggered by "Next pair") so we reach the next round.
      resolveDecodes.forEach((resolve) => resolve());
      resolveDecodes.length = 0;
      await user.click(screen.getByRole("button", { name: /next pair/i }));
      await vi.waitFor(() => {
        expect(screen.queryByText(/correct/i)).toBeNull();
      });

      // Now pick wrong — streak was 1, so the banner should read "streak of 1!".
      await user.click(screen.getByRole("button", { name: "Bulbasaur" }));
      expect(screen.getByText(/game over! streak of 1/i)).toBeInTheDocument();

      // Click "Play again" — decode is now pending; streak must NOT flip to 0 yet.
      await user.click(screen.getByRole("button", { name: /play again/i }));

      // The game-over banner must still show the correct (non-zero) streak value.
      expect(screen.getByText(/game over! streak of 1/i)).toBeInTheDocument();

      // Resolve the decode.
      resolveDecodes.forEach((resolve) => resolve());

      // After decode resolves, the banner disappears and the streak resets.
      await vi.waitFor(() => {
        expect(screen.queryByText(/game over/i)).toBeNull();
      });
      expect(
        screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Streak: 0"),
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Scroll-into-view on reveal (#1447)
  // ---------------------------------------------------------------------------
  //
  // When the user makes a guess, the result block (result message + action
  // button) should scroll into view so it is reachable without manual scrolling
  // on tall mobile viewports. We verify this by spying on scrollIntoView called
  // on the result block element.

  describe("scroll-into-view on reveal (#1447)", () => {
    let scrollIntoViewCalls: ScrollIntoViewOptions[];
    let originalScrollIntoView: typeof Element.prototype.scrollIntoView;
    let originalMatchMedia: typeof window.matchMedia;

    beforeEach(() => {
      scrollIntoViewCalls = [];
      originalScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options?: ScrollIntoViewOptions | boolean) {
        scrollIntoViewCalls.push(options as ScrollIntoViewOptions);
      };

      originalMatchMedia = window.matchMedia;
      // Default: user has not requested reduced motion.
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      window.matchMedia = originalMatchMedia;
    });

    it("calls scrollIntoView on the result block after a correct guess", async () => {
      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={SEEN} />);

      // No scroll before the user picks — still in picking phase.
      expect(scrollIntoViewCalls).toHaveLength(0);

      // Correct pick: Ivysaur has the higher attack.
      await user.click(screen.getByRole("button", { name: "Ivysaur" }));

      // Result block is shown; scrollIntoView must have fired once.
      expect(screen.getByRole("button", { name: /next pair/i })).toBeInTheDocument();
      expect(scrollIntoViewCalls).toHaveLength(1);
      // block: "nearest" means no scrolling when already in view — correct for
      // desktop where everything fits; necessary scroll on tall mobile viewports.
      expect(scrollIntoViewCalls[0]).toMatchObject({
        block: "nearest",
        behavior: "smooth",
      });
    });

    it("calls scrollIntoView after a wrong guess (Play again state)", async () => {
      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={SEEN} />);

      // Wrong pick: Bulbasaur has the lower attack.
      await user.click(screen.getByRole("button", { name: "Bulbasaur" }));

      expect(screen.getByRole("button", { name: /play again/i })).toBeInTheDocument();
      expect(scrollIntoViewCalls).toHaveLength(1);
      expect(scrollIntoViewCalls[0]).toMatchObject({
        block: "nearest",
        behavior: "smooth",
      });
    });

    it("calls scrollIntoView after a tie", async () => {
      const tied = makePokemon({
        id: 99,
        name: "Tieface",
        stats: { hp: 49, attack: 49, defense: 49, specialAttack: 49, specialDefense: 49, speed: 49 },
      });
      mockPickPair.mockReturnValue({ left: BULBASAUR, right: tied, stat: "attack" as const });

      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={[BULBASAUR, tied]} />);

      await user.click(screen.getByRole("button", { name: "Tieface" }));

      expect(screen.getByText(/equal, both count/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /next pair/i })).toBeInTheDocument();
      expect(scrollIntoViewCalls).toHaveLength(1);
      expect(scrollIntoViewCalls[0]).toMatchObject({ block: "nearest" });
    });

    it("does NOT call scrollIntoView before a guess is made (picking phase)", () => {
      render(<HigherOrLowerGame seenPokemon={SEEN} />);
      // Still in picking phase — no scroll should have fired.
      expect(scrollIntoViewCalls).toHaveLength(0);
      // Both tile buttons are present and the result block is absent.
      expect(screen.getByRole("button", { name: "Bulbasaur" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Ivysaur" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /next pair/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /play again/i })).toBeNull();
    });

    it("uses instant scroll when prefers-reduced-motion is set", async () => {
      // Override matchMedia to report reduced-motion preference.
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const user = userEvent.setup();
      render(<HigherOrLowerGame seenPokemon={SEEN} />);
      await user.click(screen.getByRole("button", { name: "Ivysaur" }));

      expect(scrollIntoViewCalls).toHaveLength(1);
      expect(scrollIntoViewCalls[0]).toMatchObject({
        behavior: "instant",
        block: "nearest",
      });
    });
  });
});
