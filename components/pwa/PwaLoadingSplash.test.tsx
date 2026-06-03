import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PwaLoadingSplash } from "./PwaLoadingSplash";

describe("PwaLoadingSplash", () => {
  afterEach(() => {
    document.getElementById("pwa-splash")?.remove();
  });

  it("renders the splash div, sets data-hiding on mount, then removes it after 250 ms", async () => {
    render(<PwaLoadingSplash />);

    expect(document.getElementById("pwa-splash")).not.toBeNull();

    await waitFor(() => {
      expect(
        document.getElementById("pwa-splash")?.hasAttribute("data-hiding"),
      ).toBe(true);
    });

    await waitFor(
      () => expect(document.getElementById("pwa-splash")).toBeNull(),
      { timeout: 1000 },
    );
  });
});
