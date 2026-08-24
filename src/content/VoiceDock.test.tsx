import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LiveUiState } from '@/shared/types';
import { VoiceDock } from './VoiceDock';

function renderDock(liveState: LiveUiState, liveBusy: boolean): string {
  return renderToStaticMarkup(
    <VoiceDock
      micOn={false}
      paused={liveState === 'paused'}
      isSpeaking={false}
      liveState={liveState}
      liveBusy={liveBusy}
      settingsOpen={false}
      variants={{}}
      onToggleMic={vi.fn()}
      onSpeak={vi.fn()}
      onTogglePause={vi.fn()}
      onToggleSettings={vi.fn()}
    />,
  );
}

function pauseButton(markup: string): string {
  const match = markup.match(/<button[^>]+aria-label="(?:Pause|Resume) session"[^>]*>/);
  expect(match?.[0]).toBeDefined();
  return match![0];
}

describe('VoiceDock live pause control', () => {
  it('renders Pause session disabled while idle', () => {
    const button = pauseButton(renderDock('idle', false));
    expect(button).toContain('aria-label="Pause session"');
    expect(button).toContain('disabled=""');
  });

  it('keeps Pause session disabled while Live is starting', () => {
    const button = pauseButton(renderDock('starting', true));
    expect(button).toContain('aria-label="Pause session"');
    expect(button).toContain('disabled=""');
  });

  it('enables Pause session only after Live is active', () => {
    const button = pauseButton(renderDock('live', true));
    expect(button).toContain('aria-label="Pause session"');
    expect(button).not.toContain('disabled=""');
  });

  it('labels an active paused session as an enabled Resume session control', () => {
    const button = pauseButton(renderDock('paused', true));
    expect(button).toContain('aria-label="Resume session"');
    expect(button).not.toContain('disabled=""');
  });
});
