import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PwaLoadingSplash } from "./PwaLoadingSplash";

describe("PwaLoadingSplash", () => {
  beforeEach(() => {
    // Simulate the #pwa-splash div created by the inline <script> in <head>
    const div = document.createElement("div");
    div.id = "pwa-splash";
    document.body.appendChild(div);
  });

  afterEach(() => {
    document.getElementById("pwa-splash")?.remove();
  });

  it("fades out and removes the inline splash after mounting", async () => {
    render(<PwaLoadingSplash />);
    await waitFor(() => {
      expect(document.getElementById("pwa-splash")?.style.opacity).toBe("0");
    });
    await waitFor(
      () => expect(document.getElementById("pwa-splash")).toBeNull(),
      { timeout: 1000 },
    );
  });

  it("renders nothing to the DOM itself", () => {
    const { container } = render(<PwaLoadingSplash />);
    expect(container.firstChild).toBeNull();
  });

  it("does not throw when no inline splash div is present", () => {
    document.getElementById("pwa-splash")?.remove();
    expect(() => render(<PwaLoadingSplash />)).not.toThrow();
  });
});
