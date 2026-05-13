let preferredVoice: SpeechSynthesisVoice | null = null;
let voicesInitialised = false;

function initVoices(): void {
  if (voicesInitialised) return;
  voicesInitialised = true;

  function pickVoice(): void {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    const local = voices.find((v) => v.localService && v.lang.startsWith("en-GB"));
    const anyGB = voices.find((v) => v.lang.startsWith("en-GB"));
    const anyEN = voices.find((v) => v.lang.startsWith("en"));
    preferredVoice = local ?? anyGB ?? anyEN ?? null;
  }

  pickVoice();
  // Chrome fires voiceschanged asynchronously; re-pick when it does.
  window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

export function speakName(name: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

  initVoices();

  // Chrome bug (crbug.com/335907): cancel() + speak() in the same tick silently no-ops.
  window.speechSynthesis.cancel();
  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(name);
    utterance.lang = "en-GB";
    if (preferredVoice !== null) utterance.voice = preferredVoice;
    window.speechSynthesis.speak(utterance);
  }, 0);
}
