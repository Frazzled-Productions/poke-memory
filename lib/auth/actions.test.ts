/**
 * Unit tests for lib/auth/actions.ts: signUpWithUsername and signInWithUsername.
 *
 * These tests mock `createClient` from @/lib/supabase/server so no real
 * Supabase connection or Next.js server context is required.
 *
 * Coverage goals (from the security review brief):
 *  1. syntheticEmail is derived from the NORMALISED username; raw email is not
 *     in the result.
 *  2. password never appears in the returned value or any error.
 *  3. signUp returns the "already registered" signal -> {ok:false, error:"username_taken"}.
 *  4. signUp returns any other error -> {ok:false, error:"signup_failed"}.
 *  5. signUp returns session:null -> {ok:false, error:"signup_failed"} (dashboard
 *     misconfiguration guard).
 *  6. signUp ok but usernames INSERT errors -> {ok:false, error:"username_taken"}.
 *  7. signUp + INSERT both ok -> {ok:true}.
 *  8. signInWithPassword error -> {ok:false, error:"invalid_credentials"}.
 *  9. signInWithPassword success -> {ok:true}.
 * 10. Username normalisation applied before syntheticEmail in both actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { syntheticEmail, normaliseUsername, MIN_PASSWORD_LENGTH } from "./username";

// ---------------------------------------------------------------------------
// Mock setup: vi.hoisted() ensures these fn instances are created before the
// vi.mock factory runs (vi.mock is hoisted to top of file by vitest).
// ---------------------------------------------------------------------------

const { mockSignUp, mockSignInWithPassword, mockInsert } = vi.hoisted(() => ({
  mockSignUp: vi.fn(),
  mockSignInWithPassword: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
    },
    from: (_table: string) => ({ insert: mockInsert }),
  }),
}));

// next/navigation redirect is irrelevant for these action tests.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// Import actions AFTER mocks are registered.
import { signUpWithUsername, signInWithUsername } from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid password that always passes the MIN_PASSWORD_LENGTH check. */
const VALID_PASSWORD = "s3cur3pass";

/** A username that needs normalisation (mixed case). */
const RAW_MIXED = "Trainer99";
const NORMALISED = normaliseUsername(RAW_MIXED); // "trainer99"
const EXPECTED_EMAIL = syntheticEmail(NORMALISED);

/** Minimal successful signUp response (no error, valid user, live session). */
function makeSignUpSuccess(overrides: { session?: null | object } = {}) {
  return {
    data: {
      user: {
        id: "user-uuid-1234",
        identities: [{ id: "some-identity" }],
      },
      session: overrides.session !== undefined ? overrides.session : { access_token: "tok" },
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: INSERT succeeds.
  mockInsert.mockResolvedValue({ error: null });
});

// ---------------------------------------------------------------------------
// signUpWithUsername
// ---------------------------------------------------------------------------

describe("signUpWithUsername", () => {
  // --- Test 7: happy path ---------------------------------------------------

  it("returns {ok:true} when signUp and INSERT both succeed", async () => {
    mockSignUp.mockResolvedValue(makeSignUpSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
  });

  // --- Test 1 + 10: normalisation + synthetic email -------------------------

  it("passes the NORMALISED username's syntheticEmail to signUp, not the raw input", async () => {
    mockSignUp.mockResolvedValue(makeSignUpSuccess());

    await signUpWithUsername(RAW_MIXED, VALID_PASSWORD);

    expect(mockSignUp).toHaveBeenCalledOnce();
    const callArg = mockSignUp.mock.calls[0][0] as { email: string };
    // The email must be derived from the normalised form.
    expect(callArg.email).toBe(EXPECTED_EMAIL);
    // The email must NOT contain the raw mixed-case form.
    expect(callArg.email).not.toContain(RAW_MIXED);
  });

  it("syntheticEmail is never present in the returned result object for signUp", async () => {
    mockSignUp.mockResolvedValue(makeSignUpSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain(EXPECTED_EMAIL);
  });

  // --- Test 2: password never in result ------------------------------------

  it("password never appears in the returned value on success", async () => {
    mockSignUp.mockResolvedValue(makeSignUpSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(JSON.stringify(result)).not.toContain(VALID_PASSWORD);
  });

  it("password never appears in an error result", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "something went wrong", code: "unknown_error", status: 500 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(JSON.stringify(result)).not.toContain(VALID_PASSWORD);
  });

  // --- Test 3: already-registered -> username_taken -------------------------

  it("maps identities.length===0 to username_taken", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: "uid", identities: [] }, session: null },
      error: { message: "User already registered", code: "email_exists", status: 422 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_taken" });
  });

  it("maps signUpError.code===email_exists to username_taken", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Email already in use", code: "email_exists", status: 422 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_taken" });
  });

  it("maps signUpError.status===422 to username_taken", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Unprocessable entity", code: "some_code", status: 422 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_taken" });
  });

  // --- Test 4: other signUp error -> signup_failed -------------------------

  it("maps an unrecognised signUp error to signup_failed", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Database connection error", code: "db_error", status: 500 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "signup_failed" });
  });

  // --- Test 5: session null -> signup_failed (dashboard misconfig) ----------

  it("returns signup_failed when session is null (email confirmation enabled)", async () => {
    mockSignUp.mockResolvedValue(makeSignUpSuccess({ session: null }));

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "signup_failed" });
  });

  // --- Test 6: signUp ok but INSERT errors -> username_taken ---------------

  it("returns username_taken when INSERT into usernames fails", async () => {
    mockSignUp.mockResolvedValue(makeSignUpSuccess());
    mockInsert.mockResolvedValue({ error: { message: "duplicate key", code: "23505" } });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_taken" });
  });

  // --- Test 10: normalisation before syntheticEmail in signUp ---------------

  it("normalises username before deriving syntheticEmail for signUp (Trainer99 -> trainer99)", async () => {
    mockSignUp.mockResolvedValue(makeSignUpSuccess());

    await signUpWithUsername("Trainer99", VALID_PASSWORD);

    const callArg = mockSignUp.mock.calls[0][0] as { email: string };
    expect(callArg.email).toBe(syntheticEmail("trainer99"));
  });

  // --- Validation guards ----------------------------------------------------

  it("rejects a too-short username without calling signUp", async () => {
    const result = await signUpWithUsername("ab", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_too_short" });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than MIN_PASSWORD_LENGTH without calling signUp", async () => {
    const shortPassword = "x".repeat(MIN_PASSWORD_LENGTH - 1);

    const result = await signUpWithUsername("trainer99", shortPassword);

    expect(result).toEqual({ ok: false, error: "password_too_short" });
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// signInWithUsername
// ---------------------------------------------------------------------------

describe("signInWithUsername", () => {
  // --- Test 9: success ------------------------------------------------------

  it("returns {ok:true} when signInWithPassword succeeds", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
  });

  // --- Test 8: error -> invalid_credentials (no enumeration leaking) -------

  it("maps any signInWithPassword error to invalid_credentials", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Invalid login credentials", status: 400 },
    });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("does not leak the specific error message from signInWithPassword", async () => {
    mockSignInWithPassword.mockResolvedValue({
      error: { message: "Email not confirmed", status: 400 },
    });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(JSON.stringify(result)).not.toContain("Email not confirmed");
    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });

  // --- Test 2: password never in result ------------------------------------

  it("password never appears in the returned value for signIn", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(JSON.stringify(result)).not.toContain(VALID_PASSWORD);
  });

  // --- Test 10: normalisation applied before syntheticEmail in signIn ------

  it("normalises username before deriving syntheticEmail for signIn (Trainer99 -> trainer99)", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    await signInWithUsername("Trainer99", VALID_PASSWORD);

    const callArg = mockSignInWithPassword.mock.calls[0][0] as { email: string };
    expect(callArg.email).toBe(syntheticEmail("trainer99"));
  });

  // --- Validation guard (maps to invalid_credentials, not the username error key) ---

  it("returns invalid_credentials for invalid username format without calling signIn", async () => {
    const result = await signInWithUsername("ab", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  // --- Test 1: syntheticEmail not in result ---------------------------------

  it("syntheticEmail is not present in the returned result object for signIn", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(JSON.stringify(result)).not.toContain("@");
  });
});
