"use client";
import { useEffect, useState } from "react";

export function PwaLoadingSplash() {
  const [hiding, setHiding] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    setHiding(true);
    const timer = setTimeout(() => setGone(true), 250);
    return () => clearTimeout(timer);
  }, []);

  if (gone) return null;

  return (
    <div
      id="pwa-splash"
      aria-hidden="true"
      // data-hiding triggers the fade-out animation in globals.css
      data-hiding={hiding ? "" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div id="pwa-splash-ball">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 64 64"
          width="56"
          height="56"
          aria-hidden="true"
        >
          <path d="M 2 32 A 30 30 0 0 0 62 32 Z" fill="var(--theme-primary,#E01B2E)" />
          <path d="M 2 32 A 30 30 0 0 1 62 32 Z" fill="white" />
          <circle cx="32" cy="32" r="30" fill="none" stroke="#1a1a1a" strokeWidth="2.5" />
          <line x1="2" y1="32" x2="62" y2="32" stroke="#1a1a1a" strokeWidth="2.5" />
          <circle cx="32" cy="32" r="9" fill="white" stroke="#1a1a1a" strokeWidth="2.5" />
          <circle cx="32" cy="32" r="5" fill="#e0e0e0" />
        </svg>
      </div>
      <span>Loading...</span>
    </div>
  );
}
