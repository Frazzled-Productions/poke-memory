import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithIntl, screen } from "@/components/test-utils/renderWithIntl";
import { AllDonePartner } from "./AllDonePartner";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const { mockPlayCry, mockPartner, mockCryUrl } = vi.hoisted(() => ({
  mockPlayCry: vi.fn(),
  mockPartner: { value: null as null | { speciesId: number; mastered: boolean } },
  mockCryUrl: { value: "/cries/94.ogg" as string | null },
}));

vi.mock("@/lib/audio/cry", () => ({ playCry: mockPlayCry }));
vi.mock("./usePartner", () => ({ usePartner: () => mockPartner.value }));
vi.mock("@/lib/pokemon/SeedContext", async () => {
  const { SEED_POKEMON } = await import("@/lib/pokemon/seed");
  return {
    useSeed: () => ({
      seed: {
        seedPokemon: SEED_POKEMON.map((p) => (p.id === 94 ? { ...p, cryUrl: mockCryUrl.value } : p)),
      },
    }),
  };
});

beforeEach(() => {
  mockPlayCry.mockClear();
  mockPartner.value = { speciesId: 94, mastered: true };
  mockCryUrl.value = "/cries/94.ogg";
});

describe("AllDonePartner (#2187)", () => {
  const CRY = {
    en: "Play Gengar's cry",
    ja: "Gengarの鳴き声を再生",
    "zh-Hans": "播放Gengar的叫声",
    "zh-Hant": "播放Gengar的叫聲",
  } as const;

  for (const locale of Object.keys(CRY) as (keyof typeof CRY)[]) {
    it(`Cry on tap: the cry plays once on a tap, never on arrival (${locale})`, async () => {
      renderWithIntl(<AllDonePartner />, { locale });
      expect(mockPlayCry).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: CRY[locale] }));
      expect(mockPlayCry).toHaveBeenCalledTimes(1);
      expect(mockPlayCry).toHaveBeenCalledWith("/cries/94.ogg");
    });
  }

  it("No cry: nothing to tap and nothing plays", () => {
    mockCryUrl.value = null;
    renderWithIntl(<AllDonePartner />);
    expect(screen.getByText("Gengar")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mockPlayCry).not.toHaveBeenCalled();
  });

  it("Unmastered partner: a silhouette with its name", () => {
    mockPartner.value = { speciesId: 94, mastered: false };
    const { container } = renderWithIntl(<AllDonePartner />);
    expect(screen.getByText("Gengar")).toBeInTheDocument();
    expect(container.querySelector("img")!.className).toContain("brightness-0");
  });

  it("No favourite: shows nothing", () => {
    mockPartner.value = null;
    const { container } = renderWithIntl(<AllDonePartner />);
    expect(container).toBeEmptyDOMElement();
  });
});
