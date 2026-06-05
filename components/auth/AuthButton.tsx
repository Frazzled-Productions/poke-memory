"use client";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth/AuthContext";
import { signOut } from "@/lib/auth/actions";
import { SignInSheet } from "@/components/auth/SignInSheet";

const TRIGGER_CLASS =
  "rounded px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-foreground";

export function AuthButton() {
  const t = useTranslations("auth");
  const { user, loading } = useAuth();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (loading) return null;

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          disabled={isPending}
          aria-haspopup="dialog"
          className={TRIGGER_CLASS}
        >
          {isPending ? t("signingIn") : t("signIn")}
        </button>
        <SignInSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      </>
    );
  }

  const meta = user.user_metadata ?? {};
  const avatarUrl = meta.avatar_url as string | undefined;
  const displayName =
    (meta.user_name as string | undefined) ??
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    (meta.email as string | undefined) ??
    "User avatar";

  return (
    <div className="flex items-center gap-2">
      {avatarUrl && (
        <Image
          src={avatarUrl}
          alt={displayName}
          // eslint-disable-next-line no-restricted-syntax -- user avatar (24 px), not a Pokémon sprite; no entry in lib/sprites/sizes.ts applies
          width={24}
          // eslint-disable-next-line no-restricted-syntax -- same as above
          height={24}
          className="rounded-full"
          unoptimized
        />
      )}
      <button
        type="button"
        onClick={() => startTransition(() => signOut())}
        disabled={isPending}
        className={TRIGGER_CLASS}
      >
        {isPending ? t("signingOut") : t("signOut")}
      </button>
    </div>
  );
}
