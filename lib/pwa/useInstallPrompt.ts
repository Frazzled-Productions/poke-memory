"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    __pwaInstallPrompt?: BeforeInstallPromptEvent;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallPromptOutcome = { outcome: "accepted" | "dismissed" };

export type InstallState =
  | { platform: "android"; canPrompt: true; prompt: () => Promise<InstallPromptOutcome> }
  | { platform: "ios"; canPrompt: false }
  | { platform: "already-installed"; canPrompt: false }
  | { platform: "unsupported"; canPrompt: false };

function detectInstallState(): InstallState {
  if (typeof window === "undefined") return { platform: "unsupported", canPrompt: false };

  // Already running as installed PWA
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true ||
    new URLSearchParams(window.location.search).get("source") === "pwa"
  ) {
    return { platform: "already-installed", canPrompt: false };
  }

  // Chrome / Android - deferred prompt captured by the inline head script
  if (window.__pwaInstallPrompt) {
    const deferred = window.__pwaInstallPrompt;
    return {
      platform: "android",
      canPrompt: true,
      prompt: async () => {
        // `prompt()` resolves with the same `{ outcome }` as `userChoice`;
        // awaiting it alone avoids racing two promises over one event.
        const { outcome } = await deferred.prompt();
        if (outcome === "accepted") {
          delete window.__pwaInstallPrompt;
        }
        return { outcome };
      },
    };
  }

  // iOS Safari - no beforeinstallprompt, show manual instructions instead.
  // iPadOS 13+ reports a desktop `Macintosh` user-agent, so an iPad is only
  // distinguishable from a real Mac by its touch support.
  const ua = navigator.userAgent;
  const isIpadOs =
    /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const isIos = /iPhone|iPad|iPod/.test(ua) || isIpadOs;
  const isChrome = /Chrome|CriOS/.test(ua);
  if (isIos && !isChrome) {
    return { platform: "ios", canPrompt: false };
  }

  return { platform: "unsupported", canPrompt: false };
}

export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState>(() => {
    // Safe for SSR - detectInstallState guards typeof window
    return detectInstallState();
  });

  useEffect(() => {
    // Re-evaluate after hydration in case window.__pwaInstallPrompt was set
    // by the inline head script before React hydrated.
    setState(detectInstallState());

    function onInstallPrompt() {
      setState(detectInstallState());
    }

    function onAppInstalled() {
      delete window.__pwaInstallPrompt;
      setState({ platform: "already-installed", canPrompt: false });
    }

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  return state;
}
