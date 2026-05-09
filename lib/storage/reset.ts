export function clearLocalProgress(): void {
  if (typeof window === "undefined") return;
  Object.keys(localStorage)
    .filter((k) => k.startsWith("poke-memory:") && !k.startsWith("poke-memory:settings:"))
    .forEach((k) => localStorage.removeItem(k));
}
