"use client";

/**
 * Dismissible notice shown to signed-out (guest) users explaining that their
 * progress is stored on this device only and how to protect it (#1057).
 *
 * Shown once; dismissal is persisted via the `guestStorageNoticeDismissed`
 * onboarding flag so it never reappears after the user closes it.
 *
 * Not shown to authenticated users — their data is already in Supabase.
 * Not shown while auth state is still loading to avoid a flash.
 */

import { useAuth } from "@/lib/auth/AuthContext";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";

export function GuestStorageNotice() {
  const { user, loading } = useAuth();

  // Render nothing while auth resolves to avoid a transient flash.
  if (loading) return null;
  // Authenticated users are not at risk — their data is synced to the cloud.
  if (user !== null) return null;

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-3">
      <OnboardingHint
        id="guestStorageNoticeDismissed"
        title="Your progress is saved on this device"
      >
        <p>
          Progress is stored in your browser and is not backed up to the cloud.
          On iOS Safari, the browser may clear it after 7 days without a visit.
        </p>
        <p className="mt-1">
          To keep your progress safe: add this page to your Home Screen, or{" "}
          <strong>sign in</strong> to back it up automatically.
        </p>
      </OnboardingHint>
    </div>
  );
}
