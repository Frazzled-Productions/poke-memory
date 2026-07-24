import React from "react";
import { describe, it, expect, vi } from "vitest";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
  screen,
} from "@/components/test-utils/renderWithIntl";
import { BadgeGalleryCard } from "./BadgeGalleryCard";
import type { BadgeDefinition } from "@/lib/badges/catalog";

// next/image requires width/height and a real loader in a full app context;
// for a unit test a plain <img> stand-in exercising the same props is enough
// (consistent with the mock pattern used elsewhere in the badges/nav tests).
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

const BOULDER: BadgeDefinition = {
  id: "boulder-badge",
  name: "Boulder Badge",
  description: "You've mastered Brock's roster.",
  lockedHint: "A Kanto gym leader's rocky roster…",
  criterion: { kind: "all-mastered", speciesIds: [74, 95] },
  artwork: "/badges/boulder-badge.png",
};

describe("BadgeGalleryCard - earned state", () => {
  it("renders the badge artwork with the badge's src", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned />);
    const img = screen.getByAltText("Boulder Badge badge artwork");
    expect(img).toHaveAttribute("src", "/badges/boulder-badge.png");
  });

  it("does not apply the grayscale silhouette filter", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned />);
    const img = screen.getByAltText("Boulder Badge badge artwork");
    expect(img.className).not.toContain("grayscale");
  });

  it("has the full accessible name on the list item", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned />);
    expect(
      screen.getByRole("listitem", { name: "Boulder Badge, earned" }),
    ).toBeInTheDocument();
  });

  it("shows the badge name as visible text", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned />);
    expect(screen.getByText("Boulder Badge")).toBeInTheDocument();
  });
});

describe("BadgeGalleryCard - locked state", () => {
  it("renders the same artwork src as a greyed silhouette", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned={false} />);
    const img = screen.getByAltText("Locked badge silhouette");
    expect(img).toHaveAttribute("src", "/badges/boulder-badge.png");
    expect(img.className).toContain("grayscale");
    expect(img.className).toContain("opacity-50");
  });

  it("does not leak the badge name via the artwork alt text", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned={false} />);
    expect(screen.queryByAltText(/Boulder Badge/)).not.toBeInTheDocument();
  });

  it("shows the lockedHint text instead of the badge name", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned={false} />);
    expect(
      screen.getByText("A Kanto gym leader's rocky roster…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Boulder Badge")).not.toBeInTheDocument();
  });

  it("has the non-spoiler accessible name on the list item", () => {
    renderWithIntl(<BadgeGalleryCard badge={BOULDER} earned={false} />);
    expect(
      screen.getByRole("listitem", {
        name: "Boulder Badge (locked): A Kanto gym leader's rocky roster…",
      }),
    ).toBeInTheDocument();
  });
});

describe("BadgeGalleryCard - locale coverage", () => {
  it("ja: earned artwork alt text is localised", () => {
    renderJa(<BadgeGalleryCard badge={BOULDER} earned />);
    expect(
      screen.getByAltText("Boulder Badgeバッジのアートワーク"),
    ).toBeInTheDocument();
  });

  it("ja: locked artwork alt text is localised", () => {
    renderJa(<BadgeGalleryCard badge={BOULDER} earned={false} />);
    expect(
      screen.getByAltText("ロックされたバッジのシルエット"),
    ).toBeInTheDocument();
  });

  it("zh-Hans: earned artwork alt text is localised", () => {
    renderZhHans(<BadgeGalleryCard badge={BOULDER} earned />);
    expect(screen.getByAltText("Boulder Badge徽章插图")).toBeInTheDocument();
  });

  it("zh-Hans: locked artwork alt text is localised", () => {
    renderZhHans(<BadgeGalleryCard badge={BOULDER} earned={false} />);
    expect(screen.getByAltText("已锁定徽章的剪影")).toBeInTheDocument();
  });

  it("zh-Hant: earned artwork alt text is localised", () => {
    renderZhHant(<BadgeGalleryCard badge={BOULDER} earned />);
    expect(screen.getByAltText("Boulder Badge徽章插圖")).toBeInTheDocument();
  });

  it("zh-Hant: locked artwork alt text is localised", () => {
    renderZhHant(<BadgeGalleryCard badge={BOULDER} earned={false} />);
    expect(screen.getByAltText("已鎖定徽章的剪影")).toBeInTheDocument();
  });
});
