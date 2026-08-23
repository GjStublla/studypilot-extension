import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSheet } from './FloatingStudyPilot';
import {
  DEFAULT_CONTEXT_SHARE_SETTINGS,
  DEFAULT_SESSION_PRIVACY,
  sessionPrivacyFromContext,
  type PageContext,
} from '@/shared/types';

const page: PageContext = {
  sourceUrl: 'https://example.test/lecture',
  sourceTitle: 'Lecture',
  host: 'example.test',
  selectedText: 'photosynthesis',
};

describe('session privacy defaults', () => {
  it('defaults screenshot capture and dashboard save off', () => {
    expect(DEFAULT_SESSION_PRIVACY).toEqual({
      captureScreenshot: false,
      saveToDashboard: false,
    });
    expect(DEFAULT_CONTEXT_SHARE_SETTINGS.screenshot).toBe(false);
    expect(DEFAULT_CONTEXT_SHARE_SETTINGS.saveToDashboard).toBe(false);
    expect(sessionPrivacyFromContext(DEFAULT_CONTEXT_SHARE_SETTINGS)).toEqual({
      captureScreenshot: false,
      saveToDashboard: false,
    });
  });

  it('can enable screenshot without enabling dashboard save', () => {
    expect(
      sessionPrivacyFromContext({
        ...DEFAULT_CONTEXT_SHARE_SETTINGS,
        screenshot: true,
      }),
    ).toEqual({ captureScreenshot: true, saveToDashboard: false });
  });

  it('can enable dashboard save without enabling screenshot', () => {
    expect(
      sessionPrivacyFromContext({
        ...DEFAULT_CONTEXT_SHARE_SETTINGS,
        saveToDashboard: true,
      }),
    ).toEqual({ captureScreenshot: false, saveToDashboard: true });
  });

  it('explains cloud processing versus storage and keeps page context separate', () => {
    const html = renderToStaticMarkup(
      <SettingsSheet
        page={page}
        context={DEFAULT_CONTEXT_SHARE_SETTINGS}
        onChange={() => undefined}
        onOpenDashboard={() => undefined}
      />,
    );

    expect(html).toContain('Google Vertex AI');
    expect(html).toContain('Screenshots are sent only when enabled');
    expect(html).toContain('Save to dashboard');
    expect(html).toContain('Page context');
    expect(html).toContain('Capture and saving');
    expect(html).toContain('name="pageUrl"');
    expect(html).toContain('name="selectedText"');
    expect(html).toContain('name="screenshot"');
    expect(html).toContain('name="saveToDashboard"');
    expect(html).not.toMatch(/name="screenshot"[^>]*checked/);
    expect(html).not.toMatch(/name="saveToDashboard"[^>]*checked/);
    expect(html).toMatch(/name="pageUrl"[^>]*checked/);
  });

  it('renders screenshot enabled without checking save to dashboard', () => {
    const html = renderToStaticMarkup(
      <SettingsSheet
        page={page}
        context={{ ...DEFAULT_CONTEXT_SHARE_SETTINGS, screenshot: true }}
        onChange={() => undefined}
        onOpenDashboard={() => undefined}
      />,
    );

    expect(html).toMatch(/name="screenshot"[^>]*checked/);
    expect(html).not.toMatch(/name="saveToDashboard"[^>]*checked/);
  });

  it('renders save to dashboard enabled without checking screenshot', () => {
    const html = renderToStaticMarkup(
      <SettingsSheet
        page={page}
        context={{ ...DEFAULT_CONTEXT_SHARE_SETTINGS, saveToDashboard: true }}
        onChange={() => undefined}
        onOpenDashboard={() => undefined}
      />,
    );

    expect(html).toMatch(/name="saveToDashboard"[^>]*checked/);
    expect(html).not.toMatch(/name="screenshot"[^>]*checked/);
  });
});
