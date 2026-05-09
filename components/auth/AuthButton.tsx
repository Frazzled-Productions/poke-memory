"use client";
import Image from "next/image";
import { useTransition } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { signIn, signOut } from "@/lib/auth/actions";

export function AuthButton() {
  const { user, loading } = useAuth();
  const [isPending, startTransition] = useTransition();

  if (loading) return null;

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => startTransition(() => signIn())}
        disabled={isPending}
        className="rounded px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-foreground"
      >
        {isPending ? "Signing in…" : "Sign in"}
      </button>
    );
  }

  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

  return (
    <div className="flex items-center gap-2">
      {avatarUrl && (
        <Image
          src={avatarUrl}
          alt={
            (user.user_metadata?.user_name as string | undefined) ??
            "GitHub avatar"
          }
          width={24}
          height={24}
          className="rounded-full"
          unoptimized
        />
      )}
      <button
        type="button"
        onClick={() => startTransition(() => signOut())}
        disabled={isPending}
        className="rounded px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-foreground"
      >
        {isPending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
