/**
 * SignInPull runs the VAPID key check (reconcileVapidKey) once per load for a
 * signed-in user, and never while a superuser flag is on (the write guard).
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, superuser, reconcileVapidKey } = vi.hoisted(() => ({
  auth: { value: { user: null as { id: string } | null, db: {} as object | null } },
  superuser: { value: { anyFlagOn: false } },
  reconcileVapidKey: vi.fn(async () => "current"),
}));
vi.mock("@/lib/auth/AuthContext", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/superuser/SuperuserContext", () => ({ useSuperuser: () => superuser.value }));
vi.mock("@/lib/sync/useSignInPull", () => ({ useSignInPull: vi.fn() }));
vi.mock("@/lib/push/subscribe", () => ({ reconcileVapidKey }));

import { SignInPull } from "./SignInPull";

const DB = { name: "data client" };

beforeEach(() => {
  reconcileVapidKey.mockClear();
  auth.value = { user: { id: "user-1" }, db: DB };
  superuser.value = { anyFlagOn: false };
});

describe("SignInPull: VAPID key check", () => {
  it("runs once per load for a signed-in user, with the data client", () => {
    const { rerender } = render(<SignInPull />);
    rerender(<SignInPull />);
    expect(reconcileVapidKey).toHaveBeenCalledTimes(1);
    expect(reconcileVapidKey).toHaveBeenCalledWith(DB, "user-1");
  });

  it("does not run for a guest", () => {
    auth.value = { user: null, db: DB };
    render(<SignInPull />);
    expect(reconcileVapidKey).not.toHaveBeenCalled();
  });

  it("does not run while a superuser flag is on", () => {
    superuser.value = { anyFlagOn: true };
    render(<SignInPull />);
    expect(reconcileVapidKey).not.toHaveBeenCalled();
  });

  it("runs when the user signs in after the page loaded", () => {
    auth.value = { user: null, db: DB };
    const { rerender } = render(<SignInPull />);
    auth.value = { user: { id: "user-1" }, db: DB };
    rerender(<SignInPull />);
    expect(reconcileVapidKey).toHaveBeenCalledTimes(1);
  });
});
