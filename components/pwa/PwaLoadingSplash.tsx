"use client";
import { useEffect } from "react";

export function PwaLoadingSplash() {
  useEffect(() => {
    const el = document.getElementById("pwa-splash");
    if (!el) return;
    el.classList.add("hiding");
    const timer = setTimeout(() => el.remove(), 250);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
