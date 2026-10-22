const STORAGE_KEY = "storekeeper-audio-feedback-enabled";
let enabledOverride = null;

export function isAudioFeedbackEnabled() {
  if (enabledOverride !== null) return enabledOverride;
  try {
    const preference = globalThis.localStorage?.getItem(STORAGE_KEY);
    return preference === null || preference === undefined ? true : preference === "true";
  } catch {
    return true;
  }
}

export function setAudioFeedbackEnabled(enabled) {
  enabledOverride = Boolean(enabled);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(enabledOverride));
  } catch {
    // Keep the preference for this session when persistent storage is unavailable.
  }
  return enabledOverride;
}

function playTones(tones) {
  if (!isAudioFeedbackEnabled()) return;
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return;

  let context;
  try {
    context = new AudioContextClass();
    const startAt = context.currentTime;
    let finishAt = startAt;
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startsAt = startAt + tone.delay;
      const endsAt = startsAt + tone.duration;
      oscillator.type = tone.type ?? "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(tone.volume, startsAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt + 0.02);
      finishAt = Math.max(finishAt, endsAt + 0.05);
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
    globalThis.setTimeout(() => {
      void context.close().catch(() => {});
    }, Math.ceil((finishAt - startAt) * 1000) + 50);
  } catch {
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
}

export function playSuccessChime() {
  playTones([
    { frequency: 523.25, delay: 0, duration: 0.14, volume: 0.12 },
    { frequency: 659.25, delay: 0.13, duration: 0.2, volume: 0.12 }
  ]);
}

export function playExpenseChime() {
  playTones([{ frequency: 440, delay: 0, duration: 0.12, volume: 0.055, type: "triangle" }]);
}

export function playErrorChime() {
  playTones([
    { frequency: 220, delay: 0, duration: 0.11, volume: 0.08, type: "triangle" },
    { frequency: 174.61, delay: 0.12, duration: 0.13, volume: 0.08, type: "triangle" }
  ]);
}

export function speakConfirmation(phrase) {
  if (!isAudioFeedbackEnabled() || typeof phrase !== "string" || !phrase.trim()) return;
  const synthesis = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  if (!synthesis || !Utterance) return;

  try {
    synthesis.cancel();
    const utterance = new Utterance(phrase.trim());
    utterance.lang = "en-GH";
    utterance.rate = 1;
    utterance.pitch = 1;
    synthesis.speak(utterance);
  } catch {
    // Speech feedback is optional and must never block saving or payment actions.
  }
}
