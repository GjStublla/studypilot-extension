import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateManifest,
  hostnameFromMatchPattern,
  isLoopbackHostname,
} from '../../scripts/manifestPolicy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const validManifest = {
  permissions: ['activeTab', 'storage', 'offscreen', 'tabs'],
  host_permissions: [
    'https://*.supabase.co/*',
    'https://generativelanguage.googleapis.com/*',
  ],
};

const runtimeWithUserMedia = ["reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK']"];

describe('validate-manifest', () => {
  it('accepts a store-valid production manifest with USER_MEDIA runtime code', () => {
    expect(evaluateManifest(validManifest, runtimeWithUserMedia)).toEqual([]);
  });

  it('fails if a named microphone permission is re-added', () => {
    const errors = evaluateManifest(
      { ...validManifest, permissions: [...validManifest.permissions, 'microphone'] },
      runtimeWithUserMedia,
    );
    expect(errors.some((error) => error.includes('microphone'))).toBe(true);
  });

  it('fails if microphone is listed as an optional permission', () => {
    const errors = evaluateManifest(
      { ...validManifest, optional_permissions: ['microphone'] },
      runtimeWithUserMedia,
    );
    expect(errors.some((error) => error.includes('microphone'))).toBe(true);
  });

  it('fails if production host_permissions include loopback hosts', () => {
    const errors = evaluateManifest(
      {
        ...validManifest,
        host_permissions: [
          ...validManifest.host_permissions,
          'http://127.0.0.1/*',
          'http://localhost:54321/*',
        ],
      },
      runtimeWithUserMedia,
    );
    expect(errors.some((error) => error.includes('127.0.0.1'))).toBe(true);
    expect(errors.some((error) => error.includes('localhost'))).toBe(true);
  });

  it('fails when the offscreen permission is missing', () => {
    const errors = evaluateManifest(
      { ...validManifest, permissions: ['storage', 'tabs'] },
      runtimeWithUserMedia,
    );
    expect(errors.some((error) => error.includes('offscreen'))).toBe(true);
  });

  it('fails when USER_MEDIA is absent from runtime code', () => {
    const errors = evaluateManifest(validManifest, ['createDocument({ reasons: [] })']);
    expect(errors.some((error) => error.includes('USER_MEDIA'))).toBe(true);
  });

  it('does not treat broad content_script matches as host_permissions', () => {
    const errors = evaluateManifest(
      {
        ...validManifest,
        content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'] }],
      },
      runtimeWithUserMedia,
    );
    expect(errors).toEqual([]);
  });

  it('parses loopback match patterns including IPv6 and ports', () => {
    expect(isLoopbackHostname(hostnameFromMatchPattern('http://127.0.0.1:4177/*'))).toBe(
      true,
    );
    expect(isLoopbackHostname(hostnameFromMatchPattern('http://[::1]/*'))).toBe(true);
    expect(isLoopbackHostname(hostnameFromMatchPattern('https://*.supabase.co/*'))).toBe(
      false,
    );
  });

  it('accepts the source production manifest (no microphone, has offscreen, no loopback hosts)', () => {
    const source = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    const liveRuntime = readFileSync(join(root, 'src/background/liveRuntime.ts'), 'utf8');
    expect(evaluateManifest(source, [liveRuntime])).toEqual([]);
    expect(source.permissions).not.toContain('microphone');
    expect(source.permissions).toContain('offscreen');
  });
});
