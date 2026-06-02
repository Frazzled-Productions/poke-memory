"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { usePastureMasteryState } from "@/lib/pasture/usePastureMasteryState";
import { WhatsNewIndicator } from "@/components/whats-new/WhatsNewIndicator";
import { AuthButton } from "@/components/auth/AuthButton";

const NAV_LINKS_HREFS = [
  { href: "/", key: "practice" },
  { href: "/stats", key: "stats" },
  { href: "/journey", key: "journey" },
  { href: "/pokedex", key: "pokedex" },
  { href: "/settings", key: "settings" },
] as const;

const LINK_BASE =
  "block rounded px-4 py-3 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 [@media(hover:hover)]:hover:bg-white/20";

/** Hamburger icon — three horizontal bars. */
function HamburgerIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={className}
    >
      <line x1="3" y1="5" x2="17" y2="5" />
      <line x1="3" y1="10" x2="17" y2="10" />
      <line x1="3" y1="15" x2="17" y2="15" />
    </svg>
  );
}

/** Close (×) icon. */
function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className={className}
    >
      <line x1="4" y1="4" x2="16" y2="16" />
      <line x1="16" y1="4" x2="4" y2="16" />
    </svg>
  );
}

/**
 * Mobile hamburger + slide-in drawer that replaces the horizontal nav link
 * list below the `md` breakpoint.
 *
 * Accessibility contract:
 * - Hamburger button carries `aria-expanded` and `aria-controls`.
 * - Focus moves into the drawer on open; focus is trapped while open.
 * - `Esc` closes the drawer and returns focus to the hamburger button.
 * - Click-outside closes the drawer.
 * - Drawer closes on route change.
 */
export function NavDrawer() {
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { showPasture } = usePastureMasteryState();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close the drawer on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Keyboard handling: Esc to close + focus trap.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }

      // Focus trap: keep tab cycles inside the drawer.
      if (e.key !== "Tab") return;
      const drawer = drawerRef.current;
      if (!drawer) return;

      const focusable = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const drawer = drawerRef.current;
      const trigger = triggerRef.current;
      if (!drawer || !trigger) return;
      if (
        !drawer.contains(e.target as Node) &&
        !trigger.contains(e.target as Node)
      ) {
        close();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const firstFocusable = drawer.querySelector<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    firstFocusable?.focus();
  }, [open]);

  // Apply `inert` to page content behind the drawer while it is open, so
  // keyboard / screen-reader users cannot reach background elements.
  useEffect(() => {
    const contentEl = document.querySelector<HTMLElement>("[data-page-content]");
    const footerEl = document.querySelector<HTMLElement>("footer");
    if (open) {
      contentEl?.setAttribute("inert", "");
      footerEl?.setAttribute("inert", "");
    } else {
      contentEl?.removeAttribute("inert");
      footerEl?.removeAttribute("inert");
    }
    return () => {
      contentEl?.removeAttribute("inert");
      footerEl?.removeAttribute("inert");
    };
  }, [open]);

  return (
    <>
      {/* Hamburger trigger — visible only below md breakpoint */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? tNav("closeMenu") : tNav("openMenu")}
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded p-2 text-theme-fg-on-primary transition-colors [@media(hover:hover)]:hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2 md:hidden"
      >
        {open ? <CloseIcon /> : <HamburgerIcon />}
      </button>

      {/* Backdrop — fixed overlay behind the drawer */}
      {open && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
        />
      )}

      {/* Drawer panel — always in the DOM so the slide transition runs.
          Closed state: translate-x-full keeps it off-screen; inert + aria-hidden
          prevent focus/announcement by AT while hidden. */}
      <div
        id="mobile-nav-drawer"
        ref={drawerRef}
        role="dialog"
        aria-label={tNav("navigationMenu")}
        aria-modal="true"
        aria-hidden={!open}
        // React 19 types `inert` as boolean. When closed the element is
        // off-screen and inaccessible; removing `hidden` lets the CSS
        // transition actually paint.
        {...(!open ? { inert: true } : {})}
        className={[
          "fixed inset-y-0 right-0 z-40 flex w-72 max-w-[calc(100vw-3rem)] flex-col",
          "border-l border-theme-secondary bg-theme-primary shadow-xl",
          "md:hidden",
          open ? "translate-x-0" : "translate-x-full",
          "transition-transform duration-200 ease-in-out",
        ].join(" ")}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between border-b border-theme-secondary px-4 py-3">
          <span className="text-sm font-semibold text-theme-fg-on-primary opacity-60">
            {tNav("menuLabel")}
          </span>
          <button
            type="button"
            aria-label={tNav("closeMenu")}
            onClick={close}
            className="flex items-center justify-center rounded p-2 text-theme-fg-on-primary transition-colors [@media(hover:hover)]:hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-2"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Link list */}
        <nav aria-label={tNav("mobileNavigation")}>
          <ul role="list" className="flex flex-col gap-1 p-3">
            {NAV_LINKS_HREFS.map(({ href, key }) => {
              const isActive =
                pathname === href ||
                (href !== "/" && pathname.startsWith(href + "/"));
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      LINK_BASE,
                      isActive
                        ? "bg-theme-fg-on-primary text-theme-primary"
                        : "text-theme-fg-on-primary opacity-75 [@media(hover:hover)]:hover:opacity-100",
                    ].join(" ")}
                  >
                    {tNav(key)}
                  </Link>
                </li>
              );
            })}
            {showPasture && (
              <li>
                <Link
                  href="/pasture"
                  aria-current={pathname === "/pasture" ? "page" : undefined}
                  className={[
                    LINK_BASE,
                    pathname === "/pasture"
                      ? "bg-theme-fg-on-primary text-theme-primary"
                      : "text-theme-fg-on-primary opacity-75 hover:opacity-100",
                  ].join(" ")}
                >
                  {tNav("pasture")}
                </Link>
              </li>
            )}
          </ul>
        </nav>

        {/* Secondary items at the bottom of the drawer */}
        <div className="mt-auto flex flex-col gap-3 border-t border-theme-secondary p-4">
          <WhatsNewIndicator />
          <AuthButton />
        </div>
      </div>
    </>
  );
}

/**
 * Static fallback rendered while the drawer's client bundle is loading.
 * Renders the hamburger button in a disabled state so the header doesn't
 * collapse or shift during hydration.
 */
export function NavDrawerFallback() {
  const tNav = useTranslations("nav");
  return (
    <button
      type="button"
      aria-label={tNav("openMenu")}
      aria-expanded={false}
      disabled
      className="flex items-center justify-center rounded p-2 text-theme-fg-on-primary opacity-60 md:hidden"
    >
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      >
        <line x1="3" y1="5" x2="17" y2="5" />
        <line x1="3" y1="10" x2="17" y2="10" />
        <line x1="3" y1="15" x2="17" y2="15" />
      </svg>
    </button>
  );
}
