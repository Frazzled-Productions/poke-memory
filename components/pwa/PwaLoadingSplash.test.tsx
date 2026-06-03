import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { PwaLoadingSplash } from "./PwaLoadingSplash";

describe("PwaLoadingSplash", () => {
  afterEach(() => {
    document.getElementById("pwa-splash")?.remove();
  });

  it("adds the hiding class on mount and removes the element after 250 ms", async () => {
    const splash = document.createElement("div");
    splash.id = "pwa-splash";
    document.body.appendChild(splash);

    render(<PwaLoadingSplash />);

    expect(splash.classList.contains("hiding")).toBe(true);
    expect(document.getElementById("pwa-splash")).not.toBeNull();

    await waitFor(
      () => expect(document.getElementById("pwa-splash")).toBeNull(),
      { timeout: 1000 },
    );
  });

  it("does not throw when no pwa-splash element exists", () => {
    expect(() => render(<PwaLoadingSplash />)).not.toThrow();
  });
});
