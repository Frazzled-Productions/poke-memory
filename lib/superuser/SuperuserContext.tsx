"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { isSuperuser, enableSuperuser, disableSuperuser, STORAGE_KEY } from "./persistence";

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
  const superuserRef = useRef(false);

  useEffect(() => {
    const initial = isSuperuser();
    setSuperuser(initial);
    superuserRef.current = initial;

    function handleStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      const next = isSuperuser();
      setSuperuser(next);
      superuserRef.current = next;
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
        pending.push(e.key);

        if (pending.length === CHORD_SEQUENCE.length) {
          pending = [];
          if (superuserRef.current) {
            disableSuperuser();
            setSuperuser(false);
            superuserRef.current = false;
          } else {
            enableSuperuser();
            setSuperuser(true);
            superuserRef.current = true;
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
          pending.push(e.key);
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
