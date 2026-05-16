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
const { mockPickPair } = vi.hoisted(() => ({ mockPickPair: vi.fn() }));

vi.mock("@/lib/minigame/higherOrLower", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minigame/higherOrLower")>();
  return {
    ...actual,
    pickPair: (...args: Parameters<typeof actual.pickPair>) => mockPickPair(...args),
    // shufflePair is a passthrough in tests — position randomisation is covered
    // by unit tests in lib/minigame/higherOrLower.test.ts.
    shufflePair: (pair: ReturnType<typeof actual.pickPair>) => pair,
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

    expect(screen.getByText(/equal — both count/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next pair/i })).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "Streak: 1"),
    ).toBeInTheDocument();
  });

  it("returns null when fewer than 2 Pokémon are provided", () => {
    const { container } = render(<HigherOrLowerGame seenPokemon={[BULBASAUR]} />);
    expect(container.firstChild).toBeNull();
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
      expect(screen.getByText(/game over — streak of 1/i)).toBeInTheDocument();

      // Click "Play again" — decode is now pending; streak must NOT flip to 0 yet.
      await user.click(screen.getByRole("button", { name: /play again/i }));

      // The game-over banner must still show the correct (non-zero) streak value.
      expect(screen.getByText(/game over — streak of 1/i)).toBeInTheDocument();

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
});
