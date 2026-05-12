let audioEl: HTMLAudioElement | null = null;

export function playCry(url: string | null, volume = 0.6): void {
  if (url === null || typeof window === "undefined") return;
  if (audioEl === null) audioEl = new HTMLAudioElement();
  audioEl.src = url;
  audioEl.volume = volume;
  audioEl.currentTime = 0;
  audioEl.loop = false;
  audioEl.play().catch((err: unknown) => {
    if (err instanceof Error && err.name === "AbortError") return;
    console.error("[cry] play failed:", err);
  });
}
