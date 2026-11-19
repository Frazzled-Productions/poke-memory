/**
 * Unit tests for lib/auth/actions.ts with Better Auth's client stubbed.
 * The server side of the same flows (throttle, taken usernames, bcrypt) is
 * tested end to end in lib/auth/server.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syntheticEmail, MIN_PASSWORD_LENGTH } from "./username";

const client = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
  signInUsername: vi.fn(),
  signInSocial: vi.fn(),
  signOut: vi.fn(),
  revokeSessions: vi.fn(),
}));

vi.mock("./client", () => ({
  authClient: {
    signUp: { email: client.signUpEmail },
    signIn: { username: client.signInUsername, social: client.signInSocial },
    signOut: client.signOut,
    revokeSessions: client.revokeSessions,
  },
}));

import { signIn, signOut, signUpWithUsername, signInWithUsername } from "./actions";

const ok = (data: unknown = { user: { id: "u1" } }) => ({ data, error: null });
const fail = (status: number, code?: string) => ({ data: null, error: { status, code, message: "server message" } });

beforeEach(() => {
  for (const fn of Object.values(client)) fn.mockReset();
});

describe("signUpWithUsername", () => {
  it("signs up with the normalised username, its synthetic email and the password", async () => {
    client.signUpEmail.mockResolvedValue(ok());
    expect(await signUpWithUsername("  Trainer99 ", "correct horse")).toEqual({ ok: true });
    expect(client.signUpEmail).toHaveBeenCalledWith({
      email: syntheticEmail("trainer99"),
      password: "correct horse",
      name: "trainer99",
      username: "trainer99",
    });
  });

  it.each([
    ["USERNAME_IS_ALREADY_TAKEN"],
    ["USER_ALREADY_EXISTS"],
    ["USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"],
  ])("maps %s to username_taken", async (code) => {
    client.signUpEmail.mockResolvedValue(fail(400, code));
    expect(await signUpWithUsername("misty", "correct horse")).toEqual({ ok: false, error: "username_taken" });
  });

  it("maps the throttle (RATE_LIMITED or 429) to rate_limited", async () => {
    client.signUpEmail.mockResolvedValue(fail(429, "RATE_LIMITED"));
    expect(await signUpWithUsername("misty", "correct horse")).toEqual({ ok: false, error: "rate_limited" });
    client.signUpEmail.mockResolvedValue(fail(429));
    expect(await signUpWithUsername("misty", "correct horse")).toEqual({ ok: false, error: "rate_limited" });
  });

  it("maps any other error, or no user, to signup_failed", async () => {
    client.signUpEmail.mockResolvedValue(fail(500, "INTERNAL_SERVER_ERROR"));
    expect(await signUpWithUsername("misty", "correct horse")).toEqual({ ok: false, error: "signup_failed" });
    client.signUpEmail.mockResolvedValue(ok(null));
    expect(await signUpWithUsername("misty", "correct horse")).toEqual({ ok: false, error: "signup_failed" });
  });

  it("validates before calling the server", async () => {
    expect(await signUpWithUsername("ab", "correct horse")).toEqual({ ok: false, error: "username_too_short" });
    expect(await signUpWithUsername("a.b.c", "correct horse")).toEqual({ ok: false, error: "username_invalid_chars" });
    expect(await signUpWithUsername("misty", "x".repeat(MIN_PASSWORD_LENGTH - 1))).toEqual({
      ok: false,
      error: "password_too_short",
    });
    expect(client.signUpEmail).not.toHaveBeenCalled();
  });

  it("never returns the password or the synthetic email", async () => {
    client.signUpEmail.mockResolvedValue(fail(400, "USERNAME_IS_ALREADY_TAKEN"));
    const result = JSON.stringify(await signUpWithUsername("misty", "s3cret-pass"));
    expect(result).not.toContain("s3cret-pass");
    expect(result).not.toContain(syntheticEmail("misty"));
  });
});

describe("signInWithUsername", () => {
  it("signs in with the normalised username", async () => {
    client.signInUsername.mockResolvedValue(ok());
    expect(await signInWithUsername("Trainer99", "correct horse")).toEqual({ ok: true });
    expect(client.signInUsername).toHaveBeenCalledWith({ username: "trainer99", password: "correct horse" });
  });

  it("gives one answer for every credential failure, without the server's message", async () => {
    client.signInUsername.mockResolvedValue(fail(401, "INVALID_USERNAME_OR_PASSWORD"));
    const result = await signInWithUsername("misty", "wrong pass");
    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    expect(JSON.stringify(result)).not.toContain("server message");
  });

  it("maps the throttle to rate_limited", async () => {
    client.signInUsername.mockResolvedValue(fail(429, "RATE_LIMITED"));
    expect(await signInWithUsername("misty", "correct horse")).toEqual({ ok: false, error: "rate_limited" });
  });

  it("answers invalid_credentials for a malformed username without calling the server", async () => {
    expect(await signInWithUsername("no", "correct horse")).toEqual({ ok: false, error: "invalid_credentials" });
    expect(client.signInUsername).not.toHaveBeenCalled();
  });
});

describe("signIn (OAuth)", () => {
  it("starts the social sign-in with callback-complete as callbackURL and the home page for errors", async () => {
    client.signInSocial.mockResolvedValue(ok({ url: "https://github.com/login/oauth/authorize" }));
    await signIn("github");
    expect(client.signInSocial).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/auth/callback-complete",
      errorCallbackURL: "/",
    });
  });

  it("ignores an unknown provider", async () => {
    await signIn("myspace" as never);
    expect(client.signInSocial).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  const assign = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("window", { location: { assign } });
    assign.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("revokes every session, then signs this browser out and reloads home", async () => {
    const order: string[] = [];
    client.revokeSessions.mockImplementation(async () => order.push("revokeSessions"));
    client.signOut.mockImplementation(async () => order.push("signOut"));
    await signOut();
    expect(order).toEqual(["revokeSessions", "signOut"]);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("still signs out locally when revoking fails", async () => {
    client.revokeSessions.mockRejectedValue(new Error("offline"));
    client.signOut.mockResolvedValue(ok());
    await signOut();
    expect(client.signOut).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/");
  });
});
