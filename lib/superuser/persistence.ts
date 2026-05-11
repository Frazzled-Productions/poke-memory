export const STORAGE_KEY = "poke-memory:superuser";

export function isSuperuser(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function enableSuperuser(): void {
  localStorage.setItem(STORAGE_KEY, "true");
}

export function disableSuperuser(): void {
  localStorage.removeItem(STORAGE_KEY);
}
