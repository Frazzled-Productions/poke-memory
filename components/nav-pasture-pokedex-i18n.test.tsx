/**
 * Locale-coverage tests for Group-5 surfaces swept in #1434 PR2.
 *
 * Mandatory coverage rule: every component that renders user-facing text must
 * be exercised in all four supported locales (en, ja, zh-Hans, zh-Hant).
 * These tests also verify the state-in / state-out rule where applicable:
 *   - NavDrawer: open (drawer visible) vs. closed
 *   - NextArrivalsStrip: empty arrivals vs. populated arrivals
 *   - BadgeGallery: no badges earned vs. some earned
 *   - StorageQuotaBanner: always visible (consumer dismisses it)
 *   - PwaInstallNudge: shown when conditions met vs. hidden
 *   - PokemonDetailDisclosure: locked vs. mastered state
 *
 * Refs: AGENTS.md "Mandatory coverage rules", closes #1434.
 */

import React from "react";
import { screen, act, fireEvent } from "@/components/test-utils/renderWithIntl";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// NavDrawer — locale coverage
// ---------------------------------------------------------------------------

// Mocks for NavDrawer
const { mockPathname } = vi.hoisted(() => ({ mockPathname: { value: "/" } }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    "aria-current": ariaCurrent,
    "aria-label": ariaLabel,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    "aria-current"?: React.AriaAttributes["aria-current"];
    "aria-label"?: string;
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/review/persistence", () => ({
  loadSession: () => Promise.resolve(null),
  STORAGE_KEY: "poke-memory:review-session:v1",
  SESSION_CHANGED_EVENT: "poke-memory:session-changed",
}));
vi.mock("@/lib/pasture/arrivals", () => ({
  filterMastered: () => [],
}));
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => ({ masteryRepetitions: 3 }),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));
vi.mock("@/lib/hooks/useLocalStorageKey", () => ({
  useLocalStorageKey: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false } }),
}));
vi.mock("@/components/whats-new/WhatsNewIndicator", () => ({
  WhatsNewIndicator: () => null,
}));
vi.mock("@/components/auth/AuthButton", () => ({
  AuthButton: () => null,
}));

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

import { NavDrawer } from "@/components/NavDrawer";

describe("NavDrawer — locale coverage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    mockPathname.value = "/";
  });

  it("en: hamburger button has correct aria-label (closed state)", () => {
    renderWithIntl(<NavDrawer />);
    expect(
      screen.getByRole("button", { name: "Open navigation menu" }),
    ).toBeInTheDocument();
  });

  it("en: after open, drawer shows 'Menu' heading and nav links", () => {
    renderWithIntl(<NavDrawer />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByText("Menu")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Practice" })).toBeInTheDocument();
  });

  it("ja: hamburger aria-label in Japanese", () => {
    renderJa(<NavDrawer />);
    expect(
      screen.getByRole("button", { name: "ナビゲーションメニューを開く" }),
    ).toBeInTheDocument();
  });

  it("ja: after open, drawer shows 'Menu' heading in Japanese", () => {
    renderJa(<NavDrawer />);
    fireEvent.click(screen.getByRole("button", { name: "ナビゲーションメニューを開く" }));
    expect(screen.getByText("メニュー")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "練習" })).toBeInTheDocument();
  });

  it("zh-Hans: hamburger aria-label in Simplified Chinese", () => {
    renderZhHans(<NavDrawer />);
    expect(
      screen.getByRole("button", { name: "打开导航菜单" }),
    ).toBeInTheDocument();
  });

  it("zh-Hans: after open, nav link for Practice in Simplified Chinese", () => {
    renderZhHans(<NavDrawer />);
    fireEvent.click(screen.getByRole("button", { name: "打开导航菜单" }));
    expect(screen.getByRole("link", { name: "练习" })).toBeInTheDocument();
  });

  it("zh-Hant: hamburger aria-label in Traditional Chinese", () => {
    renderZhHant(<NavDrawer />);
    expect(
      screen.getByRole("button", { name: "開啟導覽選單" }),
    ).toBeInTheDocument();
  });

  it("zh-Hant: after open, nav link for Practice in Traditional Chinese", () => {
    renderZhHant(<NavDrawer />);
    fireEvent.click(screen.getByRole("button", { name: "開啟導覽選單" }));
    expect(screen.getByRole("link", { name: "練習" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NextArrivalsStrip — locale coverage (state in + out)
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));
vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (_id: number | undefined, englishName: string) => ({
    name: englishName,
    transliteration: null,
  }),
}));

import { NextArrivalsStrip } from "@/components/pasture/NextArrivalsStrip";
import type { NextArrival } from "@/lib/pasture/nextArrivals";
import type { ReviewState } from "@/lib/srs/scheduler";

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    stability: 5,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 10,
    reps: 2,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2026-05-25",
    lastReview: "2026-05-15",
    firstSeen: "2026-04-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
    ...overrides,
  };
}

function makeArrival(id: number, name: string): NextArrival {
  return {
    id,
    speciesId: id,
    name,
    spriteUrl: `/sprites/pokemon/${id}.png`,
    state: makeState(),
  };
}

describe("NextArrivalsStrip — locale coverage", () => {
  it("en: empty state shows all-caught-up message", () => {
    renderWithIntl(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.getByText(/All reviewed Pokémon are already in your Pasture/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Next arrivals" }),
    ).toBeInTheDocument();
  });

  it("en: populated state shows upcoming list", () => {
    renderWithIntl(
      <NextArrivalsStrip arrivals={[makeArrival(1, "Bulbasaur")]} />,
    );
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    expect(
      screen.queryByText(/All reviewed Pokémon are already in your Pasture/i),
    ).not.toBeInTheDocument();
  });

  it("ja: heading in Japanese", () => {
    renderJa(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "次の到着" }),
    ).toBeInTheDocument();
  });

  it("ja: all-caught-up message in Japanese", () => {
    renderJa(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.getByText(/レビュー済みのポケモンはすでにすべて牧場にいます/),
    ).toBeInTheDocument();
  });

  it("zh-Hans: heading in Simplified Chinese", () => {
    renderZhHans(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "即将到来" }),
    ).toBeInTheDocument();
  });

  it("zh-Hant: heading in Traditional Chinese", () => {
    renderZhHant(<NextArrivalsStrip arrivals={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "即將到來" }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// BadgeGallery — locale coverage
// ---------------------------------------------------------------------------

import { BadgeGallery } from "@/components/badges/BadgeGallery";
import type { BadgeDefinition } from "@/lib/badges/catalog";

const STUB_BADGE: BadgeDefinition = {
  id: "boulder-badge",
  name: "Boulder Badge",
  description: "You've mastered Brock's roster.",
  lockedHint: "A Kanto gym leader's rocky roster…",
  criterion: { kind: "all-mastered", speciesIds: [74, 95] },
};

describe("BadgeGallery — locale coverage", () => {
  it("en: shows 'Gym badges' heading and no-badge message", () => {
    renderWithIntl(<BadgeGallery earnedBadges={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/No badges earned yet/i)).toBeInTheDocument();
  });

  it("en: shows 'View all badges' toggle when locked badges exist", () => {
    renderWithIntl(<BadgeGallery earnedBadges={[STUB_BADGE]} />);
    expect(
      screen.getByRole("button", { name: /View all badges/i }),
    ).toBeInTheDocument();
  });

  it("ja: heading in Japanese", () => {
    renderJa(<BadgeGallery earnedBadges={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "ジムバッジ" }),
    ).toBeInTheDocument();
  });

  it("ja: no-badge message in Japanese", () => {
    renderJa(<BadgeGallery earnedBadges={[]} />);
    expect(screen.getByText(/まだバッジを獲得していません/)).toBeInTheDocument();
  });

  it("zh-Hans: heading in Simplified Chinese", () => {
    renderZhHans(<BadgeGallery earnedBadges={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "道馆徽章" }),
    ).toBeInTheDocument();
  });

  it("zh-Hant: heading in Traditional Chinese", () => {
    renderZhHant(<BadgeGallery earnedBadges={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "道館徽章" }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StorageQuotaBanner — locale coverage
// ---------------------------------------------------------------------------

import { StorageQuotaBanner } from "@/components/review/StorageQuotaBanner";

describe("StorageQuotaBanner — locale coverage", () => {
  it("en: renders the banner text and dismiss button", () => {
    renderWithIntl(<StorageQuotaBanner onDismiss={vi.fn()} />);
    expect(
      screen.getByText(/Storage is full/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /dismiss/i }),
    ).toBeInTheDocument();
  });

  it("ja: banner text in Japanese", () => {
    renderJa(<StorageQuotaBanner onDismiss={vi.fn()} />);
    expect(
      screen.getByText(/ストレージが満杯/),
    ).toBeInTheDocument();
  });

  it("zh-Hans: banner text in Simplified Chinese", () => {
    renderZhHans(<StorageQuotaBanner onDismiss={vi.fn()} />);
    expect(
      screen.getByText(/存储空间已满/),
    ).toBeInTheDocument();
  });

  it("zh-Hant: banner text in Traditional Chinese", () => {
    renderZhHant(<StorageQuotaBanner onDismiss={vi.fn()} />);
    expect(
      screen.getByText(/儲存空間已滿/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PwaInstallNudge — locale coverage (shown when conditions met + hidden when dismissed)
// ---------------------------------------------------------------------------

const VISIT_SESSION_KEY = "poke-memory:visit-counted:v1";

// We need a mutable settings mock for PwaInstallNudge
const mockPwaLoadSettings = vi.fn(() => ({
  appVisitCount: 5,
  onboarding: { installNudgeDismissed: false },
}));
const mockPwaSaveSettings = vi.fn();
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockPwaLoadSettings(),
  saveSettings: (...args: unknown[]) => mockPwaSaveSettings(...args),
  SETTINGS_SAVED_EVENT: "poke-memory:settings-saved",
}));

const mockInstallState = vi.fn(() => ({
  platform: "ios" as const,
}));
vi.mock("@/lib/pwa/useInstallPrompt", () => ({
  useInstallPrompt: () => mockInstallState(),
}));

import { PwaInstallNudge } from "@/components/onboarding/PwaInstallNudge";

describe("PwaInstallNudge — locale coverage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "sessionStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    // Pre-count the session so we don't double-increment
    sessionStorage.setItem(VISIT_SESSION_KEY, "1");
    mockPwaLoadSettings.mockReturnValue({
      appVisitCount: 5,
      onboarding: { installNudgeDismissed: false },
    });
    mockInstallState.mockReturnValue({ platform: "ios" as const });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("en: shows nudge heading when visit threshold is met and not dismissed (state in)", async () => {
    renderWithIntl(<PwaInstallNudge />);
    // Flush the mount effect deterministically (act drains the effect + the
    // resulting re-render) rather than racing findByText's real-timer polling,
    // which intermittently timed out under coverage instrumentation (#1464).
    await act(async () => {});
    expect(screen.getByText("Install Poké Memory")).toBeInTheDocument();
  });

  it("en: does not show nudge when dismissed (state out)", async () => {
    mockPwaLoadSettings.mockReturnValue({
      appVisitCount: 5,
      onboarding: { installNudgeDismissed: true },
    });
    renderWithIntl(<PwaInstallNudge />);
    // Give time for effect to run
    await act(async () => {});
    expect(
      screen.queryByText("Install Poké Memory"),
    ).not.toBeInTheDocument();
  });

  it("ja: heading in Japanese", async () => {
    renderJa(<PwaInstallNudge />);
    await act(async () => {});
    expect(screen.getByText("Poké Memory をインストール")).toBeInTheDocument();
  });

  it("zh-Hans: heading in Simplified Chinese", async () => {
    renderZhHans(<PwaInstallNudge />);
    await act(async () => {});
    expect(screen.getByText("安装 Poké Memory")).toBeInTheDocument();
  });

  it("zh-Hant: heading in Traditional Chinese", async () => {
    renderZhHant(<PwaInstallNudge />);
    await act(async () => {});
    expect(screen.getByText("安裝 Poké Memory")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PokemonDetailDisclosure — locale coverage (locked vs. mastered)
// ---------------------------------------------------------------------------

const { mockDetailCardClass } = vi.hoisted(() => ({
  mockDetailCardClass: { value: "mastered" as string },
}));

vi.mock("@/lib/review/useCardClass", () => ({
  useCardClass: () => mockDetailCardClass.value,
}));
vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false } }),
}));
vi.mock("@/lib/pokemon/seed", () => ({
  SEED_POKEMON: [],
}));
vi.mock("@/lib/pokemon/facts", () => ({
  getPokemonFacts: () => [],
  loadFlavorTexts: () => Promise.resolve(new Map()),
}));
vi.mock("@/lib/review/useNextReviewDate", () => ({
  useNextReviewDate: () => ({ status: "not-started" }),
}));
vi.mock("@/lib/audio/tts", () => ({ speakName: vi.fn() }));
vi.mock("@/lib/audio/cry", () => ({ playCry: vi.fn() }));

import { PokemonDetailDisclosure } from "@/components/pokedex/PokemonDetailDisclosure";
import type { SeedPokemon } from "@/lib/pokemon/seed";

function makeDetailPokemon(overrides: Partial<SeedPokemon> = {}): SeedPokemon {
  return {
    id: 1,
    speciesId: 1,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: "Bulbasaur",
    name: "Bulbasaur",
    spriteUrl: "/sprites/pokemon/1.png",
    types: ["grass", "poison"],
    stats: { hp: 45, attack: 49, defense: 49, specialAttack: 65, specialDefense: 65, speed: 45 },
    flavorText: "A strange seed was planted on its back at birth.",
    flavorTexts: [],
    evolutionChain: [],
    height: 7,
    weight: 69,
    baseExperience: 64,
    genus: "Seed Pokémon",
    generation: "generation-i",
    captureRate: 45,
    baseHappiness: 50,
    growthRate: "medium-slow",
    habitat: "grassland",
    genderRate: 4,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    ...overrides,
  };
}

describe("PokemonDetailDisclosure — locale coverage", () => {
  beforeEach(() => {
    mockDetailCardClass.value = "mastered";
  });

  it("en: mastered — renders Base Stats heading and localised type", () => {
    renderWithIntl(<PokemonDetailDisclosure pokemon={makeDetailPokemon()} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Base Stats" }),
    ).toBeInTheDocument();
    // Type chip should be localised (not raw lowercase "grass")
    expect(screen.getByText("Grass")).toBeInTheDocument();
  });

  it("en: locked — renders locked hint text", () => {
    mockDetailCardClass.value = "locked";
    renderWithIntl(<PokemonDetailDisclosure pokemon={makeDetailPokemon()} />);
    expect(
      screen.getByText(/Start learning this Pokémon to reveal its details/i),
    ).toBeInTheDocument();
  });

  it("ja: mastered — renders Base Stats heading in Japanese", () => {
    renderJa(<PokemonDetailDisclosure pokemon={makeDetailPokemon()} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "種族値" }),
    ).toBeInTheDocument();
  });

  it("ja: locked — renders locked hint in Japanese", () => {
    mockDetailCardClass.value = "locked";
    renderJa(<PokemonDetailDisclosure pokemon={makeDetailPokemon()} />);
    expect(
      screen.getByText(/このポケモンの学習を開始すると詳細が表示されます/),
    ).toBeInTheDocument();
  });

  it("zh-Hans: mastered — renders Base Stats heading in Simplified Chinese", () => {
    renderZhHans(<PokemonDetailDisclosure pokemon={makeDetailPokemon()} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "种族值" }),
    ).toBeInTheDocument();
  });

  it("zh-Hant: mastered — renders Base Stats heading in Traditional Chinese", () => {
    renderZhHant(<PokemonDetailDisclosure pokemon={makeDetailPokemon()} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "種族值" }),
    ).toBeInTheDocument();
  });

  it("en: mastered with evolution chain renders Evolution Chain heading", () => {
    const pokemon = makeDetailPokemon({
      evolutionChain: [
        { speciesId: 1, name: "Bulbasaur", evolvesFromId: null },
        { speciesId: 2, name: "Ivysaur", evolvesFromId: 1 },
      ],
    });
    renderWithIntl(<PokemonDetailDisclosure pokemon={pokemon} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Evolution Chain" }),
    ).toBeInTheDocument();
  });

  it("ja: mastered with evolution chain renders Evolution Chain heading in Japanese", () => {
    const pokemon = makeDetailPokemon({
      evolutionChain: [
        { speciesId: 1, name: "Bulbasaur", evolvesFromId: null },
        { speciesId: 2, name: "Ivysaur", evolvesFromId: 1 },
      ],
    });
    renderJa(<PokemonDetailDisclosure pokemon={pokemon} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "進化チェーン" }),
    ).toBeInTheDocument();
  });
});
