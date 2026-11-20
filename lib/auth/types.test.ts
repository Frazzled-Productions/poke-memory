import { describe, expect, it } from "vitest";
import { toAppUser } from "./types";

describe("toAppUser", () => {
  it("maps a username account", () => {
    const user = toAppUser(
      { id: "u1", email: "ash@users.noreply.pokememory.internal", name: "ash", username: "ash", image: null, createdAt: new Date("2026-01-02T03:04:05.000Z") },
      [{ providerId: "credential", accountId: "u1" }],
    );
    expect(user).toEqual({
      id: "u1",
      email: "ash@users.noreply.pokememory.internal",
      created_at: "2026-01-02T03:04:05.000Z",
      user_metadata: { username: "ash", name: "ash", full_name: "ash" },
      app_metadata: { provider: "email", providers: ["email"] },
      identities: [{ provider: "email", id: "u1" }],
    });
  });

  it("maps a GitHub account linked to Google, with the avatar", () => {
    const user = toAppUser(
      { id: "u2", email: "misty@example.com", name: "Misty", image: "https://avatars.example/m.png", createdAt: "2026-02-01T00:00:00.000Z" },
      [
        { providerId: "github", accountId: "123" },
        { providerId: "google", accountId: "456" },
      ],
    );
    expect(user.user_metadata).toEqual({ name: "Misty", full_name: "Misty", avatar_url: "https://avatars.example/m.png" });
    expect(user.identities.map((i) => i.provider)).toEqual(["github", "google"]);
    expect(user.app_metadata).toEqual({ provider: "github", providers: ["github", "google"] });
  });

  it("exposes a GitHub account's login (displayUsername) as user_name, for the trainer card handle", () => {
    const user = toAppUser(
      { id: "u3", email: "brock@example.com", name: "Brock", displayUsername: "Brock-H", createdAt: "2026-03-01T00:00:00.000Z" },
      [{ providerId: "github", accountId: "789" }],
    );
    expect(user.user_metadata).toEqual({ name: "Brock", full_name: "Brock", user_name: "Brock-H" });
  });

  it("does not expose displayUsername as user_name for a username account", () => {
    const user = toAppUser(
      { id: "u1", email: null, name: "ash", username: "ash", displayUsername: "ash", createdAt: "2026-01-02T00:00:00.000Z" },
      [{ providerId: "credential", accountId: "u1" }],
    );
    expect(user.user_metadata.user_name).toBeUndefined();
    expect(user.user_metadata.username).toBe("ash");
  });
});
