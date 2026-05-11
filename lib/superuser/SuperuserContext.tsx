"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { isSuperuser, enableSuperuser, disableSuperuser } from "./persistence";

const STORAGE_KEY = "poke-memory:superuser";

// Typing "super" anywhere (when not focused on an input) toggles the mode.
const CHORD_SEQUENCE = ["s", "u", "p", "e", "r"];
const CHORD_TIMEOUT_MS = 2000;

type SuperuserContextValue = { superuser: boolean };

const SuperuserContext = createContext<SuperuserContextValue>({ superuser: false });

export function useSuperuser(): SuperuserContextValue {
  return useContext(SuperuserContext);
}

export function SuperuserProvider({ children }: { children: React.ReactNode }) {
  const [superuser, setSuperuser] = useState(false);

  useEffect(() => {
    setSuperuser(isSuperuser());

    function handleStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setSuperuser(isSuperuser());
    }

    let pending: string[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === CHORD_SEQUENCE[pending.length]) {
        if (timeoutId !== null) clearTimeout(timeoutId);
        pending = [...pending, e.key];

        if (pending.length === CHORD_SEQUENCE.length) {
          pending = [];
          if (isSuperuser()) {
            disableSuperuser();
            setSuperuser(false);
          } else {
            enableSuperuser();
            setSuperuser(true);
          }
        } else {
          timeoutId = setTimeout(() => {
            pending = [];
          }, CHORD_TIMEOUT_MS);
        }
      } else {
        if (timeoutId !== null) clearTimeout(timeoutId);
        pending = [];
        // Restart sequence if this key matches the first char
        if (e.key === CHORD_SEQUENCE[0]) {
          pending = [e.key];
          timeoutId = setTimeout(() => {
            pending = [];
          }, CHORD_TIMEOUT_MS);
        }
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("keydown", handleKeyDown);
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, []);

  return (
    <SuperuserContext.Provider value={{ superuser }}>
      {children}
    </SuperuserContext.Provider>
  );
}
