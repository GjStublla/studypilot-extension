import { afterEach, describe, expect, it, vi } from 'vitest';
import { DASHBOARD_URL } from '@/shared/config';
import {
  getStoredSupabaseSession,
  isDashboardBridgeOrigin,
  readDashboardAuthSession,
} from './workspaceAuth';

describe('workspace auth boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects malformed stored auth values without throwing', () => {
    expect(getStoredSupabaseSession(null)).toBeNull();
    expect(getStoredSupabaseSession({ user: { id: 'user-1' } })).toBeNull();
    expect(getStoredSupabaseSession({ access_token: 42 })).toBeNull();
  });

  it('normalizes nested Supabase session storage into the extension shape', () => {
    expect(getStoredSupabaseSession({
      currentSession: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_at: 123,
        user: { id: 'user-1', email: 'student@example.com' },
      },
    })).toEqual({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      user_id: 'user-1',
      email: 'student@example.com',
      expires_at: 123,
    });
  });

  it('reads the direct dashboard token only on the dashboard origin', () => {
    const values: Record<string, string> = {
      sp_access_token: 'access-2',
      sp_refresh_token: 'refresh-2',
      sp_user_id: 'user-2',
      sp_email: 'student2@example.com',
    };
    const localStorage = {
      getItem: (key: string) => values[key] ?? null,
    };
    const dashboardOrigin = new URL(DASHBOARD_URL).origin;
    vi.stubGlobal('window', { location: { origin: dashboardOrigin }, localStorage });

    expect(isDashboardBridgeOrigin()).toBe(true);
    expect(readDashboardAuthSession()).toEqual({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      user_id: 'user-2',
      email: 'student2@example.com',
    });

    vi.stubGlobal('window', { location: { origin: 'https://example.com' }, localStorage });
    expect(isDashboardBridgeOrigin()).toBe(false);
    expect(readDashboardAuthSession()).toBeNull();
  });
});
