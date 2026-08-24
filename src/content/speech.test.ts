import { describe, expect, it, vi } from 'vitest';
import { createSpeechUtterance, selectBestSpeechVoice } from './speech';

function voice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang } as SpeechSynthesisVoice;
}

describe('speech utilities', () => {
  it('returns no voice when the browser has not loaded any voices', () => {
    expect(selectBestSpeechVoice([])).toBeNull();
  });

  it('prefers a Google English voice for natural coaching speech', () => {
    const google = voice('Google UK English Female', 'en-GB');
    const fallback = voice('Microsoft David', 'en-US');

    expect(selectBestSpeechVoice([fallback, google])).toBe(google);
  });

  it('falls back to en-US and then the first available voice', () => {
    const english = voice('Microsoft Jenny', 'en-US');
    const first = voice('Deutsch', 'de-DE');

    expect(selectBestSpeechVoice([first, english])).toBe(english);
    expect(selectBestSpeechVoice([first])).toBe(first);
  });

  it('configures an utterance through the browser adapter', () => {
    class FakeSpeechSynthesisUtterance {
      readonly text: string;
      rate = 0;
      pitch = 0;
      volume = 0;
      voice: SpeechSynthesisVoice | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    const selected = voice('Google US English', 'en-US');
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      FakeSpeechSynthesisUtterance as unknown as typeof SpeechSynthesisUtterance,
    );

    try {
      const utterance = createSpeechUtterance('Read this explanation', {
        getVoices: () => [selected],
      } as SpeechSynthesis);

      expect(utterance).toMatchObject({
        text: 'Read this explanation',
        rate: 1.05,
        pitch: 1,
        volume: 1,
        voice: selected,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
