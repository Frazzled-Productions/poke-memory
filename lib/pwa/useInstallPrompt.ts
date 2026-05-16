"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    __pwaInstallPrompt?: BeforeInstallPromptEvent;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
  | { platform: "android"; canPrompt: true; prompt: () => Promise<void> }
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

  // Chrome / Android — deferred prompt captured by the inline head script
  if (window.__pwaInstallPrompt) {
    const deferred = window.__pwaInstallPrompt;
    return {
      platform: "android",
      canPrompt: true,
      prompt: async () => {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") {
          delete window.__pwaInstallPrompt;
        }
      },
    };
  }

  // iOS Safari — no beforeinstallprompt, show manual instructions instead
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isChrome = /Chrome|CriOS/.test(ua);
  if (isIos && !isChrome) {
    return { platform: "ios", canPrompt: false };
  }

  return { platform: "unsupported", canPrompt: false };
}

export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState>(() => {
    // Safe for SSR — detectInstallState guards typeof window
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
