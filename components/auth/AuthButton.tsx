"use client";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth/AuthContext";
import { signIn, signOut } from "@/lib/auth/actions";
import type { AuthProvider } from "@/lib/auth/types";

const TRIGGER_CLASS =
  "rounded px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-foreground";

function SignInPicker({ isPending, onChoose }: { isPending: boolean; onChoose: (p: AuthProvider) => void }) {
  const t = useTranslations("auth");
  const [open, setOpen] = useState(false);
  const [triggerBottom, setTriggerBottom] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // On mobile the panel is `position: fixed` pinned to the right edge of the
    // viewport, with `top` driven by the trigger's bottom. Recompute on resize
    // and on any scroll in case the header is in a scrolling container.
    function updateTriggerPos() {
      const r = triggerRef.current?.getBoundingClientRect();
      setTriggerBottom(r ? r.bottom : null);
    }
    updateTriggerPos();
    window.addEventListener("resize", updateTriggerPos);
    window.addEventListener("scroll", updateTriggerPos, true);

    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", updateTriggerPos);
      window.removeEventListener("scroll", updateTriggerPos, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="sign-in-picker-panel"
        className={TRIGGER_CLASS}
      >
        {isPending ? t("signingIn") : t("signIn")}
      </button>
      {open && (
        <div
          id="sign-in-picker-panel"
          role="menu"
          aria-label={t("chooseProvider")}
          // Mobile: `position: fixed` pinned to the right edge of the viewport,
          // top computed from the trigger's bbox. Header wrap puts the trigger
          // on the left edge on narrow viewports and the right edge on wider
          // mobile viewports (e.g. 430px), so anchoring to either side of the
          // trigger overflows in one of the two cases — pin to the viewport
          // instead. Desktop (sm:): restore absolute positioning under the
          // trigger via `right-0`.
          style={
            triggerBottom !== null
              ? ({ ["--signin-top" as string]: `${triggerBottom}px` } as React.CSSProperties)
              : undefined
          }
          className="fixed right-2 top-[calc(var(--signin-top,3rem)+0.5rem)] z-50 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-zinc-200 bg-background p-3 shadow-lg sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:max-w-none dark:border-zinc-700"
        >
          <p
            id="sign-in-picker-hint"
            role="presentation"
            className="mb-2 text-xs text-zinc-600 dark:text-zinc-400"
          >
            {t("providerHint")}
          </p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              role="menuitem"
              aria-describedby="sign-in-picker-hint"
              onClick={() => {
                setOpen(false);
                onChoose("github");
              }}
              disabled={isPending}
              className="rounded px-3 py-1.5 text-left text-sm font-medium text-foreground hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:hover:bg-zinc-800"
            >
              {t("continueWithGitHub")}
            </button>
            <button
              type="button"
              role="menuitem"
              aria-describedby="sign-in-picker-hint"
              onClick={() => {
                setOpen(false);
                onChoose("google");
              }}
              disabled={isPending}
              className="rounded px-3 py-1.5 text-left text-sm font-medium text-foreground hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:opacity-50 dark:hover:bg-zinc-800"
            >
              {t("continueWithGoogle")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AuthButton() {
  const t = useTranslations("auth");
  const { user, loading } = useAuth();
  const [isPending, startTransition] = useTransition();

  if (loading) return null;

  if (!user) {
    return (
      <SignInPicker
        isPending={isPending}
        onChoose={(provider) => startTransition(() => signIn(provider))}
      />
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
        className={TRIGGER_CLASS}
      >
        {isPending ? t("signingOut") : t("signOut")}
      </button>
    </div>
  );
}
