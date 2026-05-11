const KEY = "poke-memory:superuser";

export function isSuperuser(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(KEY) === "true";
}

export function enableSuperuser(): void {
  localStorage.setItem(KEY, "true");
}

export function disableSuperuser(): void {
  localStorage.removeItem(KEY);
}
