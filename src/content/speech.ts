/**
 * Select the most natural English voice available to the browser.
 * Prefers Google's neural voices, then an en-US voice, then the first voice.
 */
export function selectBestSpeechVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const googleNeural = voices.find((voice) => voice.name.includes('Google') && voice.lang.startsWith('en'));
  if (googleNeural) return googleNeural;

  const english = voices.find((voice) => voice.lang.startsWith('en-US'));
  return english ?? voices[0] ?? null;
}

/**
 * Create a consistently configured browser speech utterance.
 * The browser API stays at this adapter boundary; voice selection is pure above.
 */
export function createSpeechUtterance(
  text: string,
  speechSynthesis: SpeechSynthesis = window.speechSynthesis,
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const voice = selectBestSpeechVoice(speechSynthesis.getVoices());
  if (voice) utterance.voice = voice;

  return utterance;
}
