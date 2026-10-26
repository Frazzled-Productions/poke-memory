import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS, saveSettings } from "@/lib/settings/persistence";
import { REVERSE_ID_OFFSET } from "@/lib/pokemon/seed-constants";
import { initialReviewState } from "@/lib/srs/scheduler";
import type { ReviewableCard } from "@/lib/review/session";
import { usePartner } from "./usePartner";

const { mockCards, mockPretend } = vi.hoisted(() => ({
  mockCards: { value: [] as unknown[] },
  mockPretend: { value: false },
}));

vi.mock("@/lib/review/persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/review/persistence")>()),
  loadSession: () => Promise.resolve({ cards: mockCards.value }),
}));

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: mockPretend.value } }),
}));

const MASTERED = { ...initialReviewState(new Date("2026-01-01")), stability: 30, lastReview: "2026-01-01", firstSeen: "2025-12-01" };

function masteredPair(id: number): ReviewableCard[] {
  return [
    { id, cardType: "name", locale: "en", state: MASTERED } as unknown as ReviewableCard,
    { id: REVERSE_ID_OFFSET + id, pokemonId: id, cardType: "reverse", locale: "en", state: MASTERED } as unknown as ReviewableCard,
  ];
}

beforeEach(() => {
  window.localStorage.clear();
  mockCards.value = [];
  mockPretend.value = false;
});

describe("usePartner (#2187)", () => {
  it("is null with no favourite", async () => {
    saveSettings({ ...DEFAULT_SETTINGS });
    const { result } = renderHook(() => usePartner());
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("Unmastered partner: mastered is false", async () => {
    saveSettings({ ...DEFAULT_SETTINGS, favouritePokemonId: 94, heartedSpeciesIds: [94] });
    const { result } = renderHook(() => usePartner());
    await waitFor(() => expect(result.current).toEqual({ speciesId: 94, mastered: false }));
  });

  it("Mastered partner: both legs mastered in an enrolled locale", async () => {
    mockCards.value = masteredPair(94);
    saveSettings({ ...DEFAULT_SETTINGS, favouritePokemonId: 94, heartedSpeciesIds: [94] });
    const { result } = renderHook(() => usePartner());
    await waitFor(() => expect(result.current).toEqual({ speciesId: 94, mastered: true }));
  });

  it("Superuser pretendAllMastered counts the favourite as mastered", async () => {
    mockPretend.value = true;
    saveSettings({ ...DEFAULT_SETTINGS, favouritePokemonId: 94, heartedSpeciesIds: [94] });
    const { result } = renderHook(() => usePartner());
    await waitFor(() => expect(result.current).toEqual({ speciesId: 94, mastered: true }));
  });

  it("follows a favourite set later in the same tab", async () => {
    saveSettings({ ...DEFAULT_SETTINGS });
    const { result } = renderHook(() => usePartner());
    await waitFor(() => expect(result.current).toBeNull());
    saveSettings({ ...DEFAULT_SETTINGS, favouritePokemonId: 25, heartedSpeciesIds: [25] });
    await waitFor(() => expect(result.current).toEqual({ speciesId: 25, mastered: false }));
  });
});
