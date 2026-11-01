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
 *  3. createUser returns email_exists -> {ok:false, error:"username_taken"}.
 *  4. createUser returns any other error -> {ok:false, error:"signup_failed"}.
 *  5. sign-in after createUser fails -> {ok:false, error:"signup_failed"}, and the
 *     new user is removed so the username stays free.
 *  6. createUser ok but usernames INSERT errors -> {ok:false, error:"username_taken"}.
 *  7. createUser + sign-in + INSERT all ok -> {ok:true}.
 *  8. signInWithPassword error -> {ok:false, error:"invalid_credentials"}.
 *  9. signInWithPassword success -> {ok:true}.
 * 10. Username normalisation applied before syntheticEmail in both actions.
 * 11. check_rate_limit RPC returning false -> {ok:false, error:"rate_limited"} without
 *     calling createUser / signInWithPassword.
 * 12. check_rate_limit RPC error -> {ok:false, error:"rate_limited"} (fail-safe).
 * 13. check_rate_limit returning true -> proceeds to the normal auth path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { syntheticEmail, normaliseUsername, MIN_PASSWORD_LENGTH } from "./username";

// ---------------------------------------------------------------------------
// Mock setup: vi.hoisted() ensures these fn instances are created before the
// vi.mock factory runs (vi.mock is hoisted to top of file by vitest).
// ---------------------------------------------------------------------------

const {
  mockSignUp,
  mockSignInWithPassword,
  mockCreateUser,
  mockDeleteUser,
  mockCreateAdminClient,
  mockInsert,
  mockRpc,
  mockHeaders,
} =
  vi.hoisted(() => ({
    mockSignUp: vi.fn(),
    mockSignInWithPassword: vi.fn(),
    mockCreateUser: vi.fn(),
    mockDeleteUser: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockInsert: vi.fn(),
    mockRpc: vi.fn(),
    mockHeaders: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      signUp: mockSignUp,
      signInWithPassword: mockSignInWithPassword,
    },
    from: (_table: string) => ({ insert: mockInsert }),
    rpc: mockRpc,
  }),
}));

// The admin client: sign-up creates the account with the secret key.
vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateAdminClient,
}));

// next/navigation redirect is irrelevant for these action tests.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

// Mock next/headers so the actions can read x-forwarded-for without a real
// Next.js request context. Return a stub Headers-like object.
vi.mock("next/headers", () => ({
  headers: mockHeaders,
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

/** Minimal successful createUser response. */
function makeCreateUserSuccess() {
  return { data: { user: { id: "user-uuid-1234" } }, error: null };
}

/** Minimal successful signInWithPassword response (live session). */
function makeSignInSuccess() {
  return { data: { session: { access_token: "tok" } }, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  mockCreateAdminClient.mockReturnValue({
    auth: { admin: { createUser: mockCreateUser, deleteUser: mockDeleteUser } },
  });
  mockDeleteUser.mockResolvedValue({ data: {}, error: null });
  mockSignInWithPassword.mockResolvedValue(makeSignInSuccess());
  // Default: INSERT succeeds.
  mockInsert.mockResolvedValue({ error: null });
  // Default: rate limit allows the request.
  mockRpc.mockResolvedValue({ data: true, error: null });
  // Default: x-forwarded-for returns a stable test IP.
  mockHeaders.mockResolvedValue({ get: (name: string) => (name === "x-forwarded-for" ? "1.2.3.4" : null) });
});

// ---------------------------------------------------------------------------
// signUpWithUsername
// ---------------------------------------------------------------------------

describe("signUpWithUsername", () => {
  // --- Test 7: happy path ---------------------------------------------------

  it("returns {ok:true} when create, sign-in and INSERT all succeed", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
  });

  // --- Test 1 + 10: normalisation + synthetic email -------------------------

  it("passes the NORMALISED username's syntheticEmail to createUser, not the raw input", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    await signUpWithUsername(RAW_MIXED, VALID_PASSWORD);

    expect(mockCreateUser).toHaveBeenCalledOnce();
    const callArg = mockCreateUser.mock.calls[0][0] as { email: string };
    // The email must be derived from the normalised form.
    expect(callArg.email).toBe(EXPECTED_EMAIL);
    // The email must NOT contain the raw mixed-case form.
    expect(callArg.email).not.toContain(RAW_MIXED);
  });

  it("syntheticEmail is never present in the returned result object for createUser", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("@");
    expect(serialised).not.toContain(EXPECTED_EMAIL);
  });

  // --- Test 2: password never in result ------------------------------------

  it("password never appears in the returned value on success", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(JSON.stringify(result)).not.toContain(VALID_PASSWORD);
  });

  it("password never appears in an error result", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "something went wrong", code: "unknown_error", status: 500 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(JSON.stringify(result)).not.toContain(VALID_PASSWORD);
  });

  // --- Test 3: already-registered -> username_taken -------------------------

  it("maps createUser code===email_exists to username_taken", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Email already in use", code: "email_exists", status: 422 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_taken" });
  });

  it("maps unrecognised createUser error (status 422, unknown code) to signup_failed", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Unprocessable entity", code: "some_code", status: 422 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "signup_failed" });
  });

  // --- Test 4: other createUser error -> signup_failed -------------------------

  it("maps an unrecognised createUser error to signup_failed", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Database connection error", code: "db_error", status: 500 },
    });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "signup_failed" });
  });

  // --- Test 5: sign-in after create fails -> signup_failed, no stranded account

  it("returns signup_failed and removes the new user when the follow-up sign-in fails", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());
    mockSignInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "boom" } });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "signup_failed" });
    expect(mockDeleteUser).toHaveBeenCalledWith("user-uuid-1234");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns signup_failed and removes the new user when sign-in returns no session", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());
    mockSignInWithPassword.mockResolvedValue({ data: { session: null }, error: null });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "signup_failed" });
    expect(mockDeleteUser).toHaveBeenCalledWith("user-uuid-1234");
  });

  // --- New path: server-side creation, independent of the confirmation setting

  it("creates the account server-side, already confirmed, and never calls public signUp", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(mockCreateAdminClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "sb_secret_test",
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false } }),
    );
    expect(mockCreateUser).toHaveBeenCalledWith({
      email: EXPECTED_EMAIL,
      password: VALID_PASSWORD,
      email_confirm: true,
      user_metadata: { username: NORMALISED },
    });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("signs in with the same credentials, then inserts the username row", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: EXPECTED_EMAIL, password: VALID_PASSWORD });
    expect(mockInsert).toHaveBeenCalledWith({ username: NORMALISED, user_id: "user-uuid-1234" });
    expect(mockSignInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(
      mockInsert.mock.invocationCallOrder[0],
    );
  });

  it("returns signup_failed without creating an account when no secret key is set", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "signup_failed" });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- Test 6: createUser ok but INSERT errors -> username_taken ---------------

  it("returns username_taken when INSERT into usernames fails", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());
    mockInsert.mockResolvedValue({ error: { message: "duplicate key", code: "23505" } });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_taken" });
  });

  // --- Test 10: normalisation before syntheticEmail in createUser ---------------

  it("normalises username before deriving syntheticEmail for createUser (Trainer99 -> trainer99)", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    await signUpWithUsername("Trainer99", VALID_PASSWORD);

    const callArg = mockCreateUser.mock.calls[0][0] as { email: string };
    expect(callArg.email).toBe(syntheticEmail("trainer99"));
  });

  // --- Validation guards ----------------------------------------------------

  it("rejects a too-short username without calling createUser", async () => {
    const result = await signUpWithUsername("ab", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "username_too_short" });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than MIN_PASSWORD_LENGTH without calling createUser", async () => {
    const shortPassword = "x".repeat(MIN_PASSWORD_LENGTH - 1);

    const result = await signUpWithUsername("trainer99", shortPassword);

    expect(result).toEqual({ ok: false, error: "password_too_short" });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- Test 11: rate_limited branch -----------------------------------------

  it("returns rate_limited without calling createUser when the RPC returns false", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- Test 12: RPC error -> fail-safe rate_limited -------------------------

  it("returns rate_limited without calling createUser when the RPC returns an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db error" } });

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  // --- Test 13: RPC allowed -> proceeds to createUser ---------------------------

  it("proceeds to createUser when the RPC returns true", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    const result = await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
    expect(mockCreateUser).toHaveBeenCalledOnce();
  });

  it("calls check_rate_limit RPC with action 'signup'", async () => {
    mockCreateUser.mockResolvedValue(makeCreateUserSuccess());

    await signUpWithUsername("trainer99", VALID_PASSWORD);

    expect(mockRpc).toHaveBeenCalledWith("check_rate_limit", expect.objectContaining({ p_action: "signup" }));
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

  // --- Rate-limit branches for signIn (Tests 11-13) -------------------------

  it("returns rate_limited without calling signInWithPassword when the RPC returns false", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("returns rate_limited without calling signInWithPassword when the RPC returns an error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "db error" } });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it("proceeds to signInWithPassword when the RPC returns true", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockSignInWithPassword.mockResolvedValue({ error: null });

    const result = await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(result).toEqual({ ok: true });
    expect(mockSignInWithPassword).toHaveBeenCalledOnce();
  });

  it("calls check_rate_limit RPC with action 'signin'", async () => {
    mockSignInWithPassword.mockResolvedValue({ error: null });

    await signInWithUsername("trainer99", VALID_PASSWORD);

    expect(mockRpc).toHaveBeenCalledWith("check_rate_limit", expect.objectContaining({ p_action: "signin" }));
  });
});
