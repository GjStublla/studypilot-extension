import { DASHBOARD_URL } from '@/shared/config';
import type { ExtensionAuthSession } from '@/shared/types';

const ACCESS_KEY = 'sp_access_token';
const REFRESH_KEY = 'sp_refresh_token';
const USER_ID_KEY = 'sp_user_id';
const EMAIL_KEY = 'sp_email';
const SUPABASE_OAUTH_STORAGE_KEY = 'sp-oauth-session';

export function isDashboardBridgeOrigin(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return window.location.origin === new URL(DASHBOARD_URL).origin;
  } catch {
    return false;
  }
}

export function readDashboardAuthSession(): ExtensionAuthSession | null {
  if (!isDashboardBridgeOrigin()) return null;

  try {
    const accessToken = window.localStorage.getItem(ACCESS_KEY);
    if (accessToken) {
      return {
        access_token: accessToken,
        refresh_token: window.localStorage.getItem(REFRESH_KEY) ?? undefined,
        user_id: window.localStorage.getItem(USER_ID_KEY) ?? undefined,
        email: window.localStorage.getItem(EMAIL_KEY),
      };
    }

    return readSupabaseStoredAuthSession();
  } catch {
    return null;
  }
}

export function readSupabaseStoredAuthSession(): ExtensionAuthSession | null {
  if (typeof window === 'undefined') return null;

  const candidateKeys = Object.keys(window.localStorage).filter(
    (key) => key === SUPABASE_OAUTH_STORAGE_KEY || /^sb-.+-auth-token$/.test(key),
  );

  for (const key of candidateKeys) {
    const stored = window.localStorage.getItem(key);
    if (!stored) continue;

    try {
      const parsed = JSON.parse(stored) as unknown;
      const session = getStoredSupabaseSession(parsed);
      if (session) return session;
    } catch {
      continue;
    }
  }

  return null;
}

export function getStoredSupabaseSession(value: unknown): ExtensionAuthSession | null {
  if (!isObject(value)) return null;

  const sessionValue = isObject(value.currentSession)
    ? value.currentSession
    : isObject(value.session)
      ? value.session
      : value;

  if (!isObject(sessionValue) || typeof sessionValue.access_token !== 'string') {
    return null;
  }

  const user = isObject(sessionValue.user) ? sessionValue.user : null;
  return {
    access_token: sessionValue.access_token,
    refresh_token: typeof sessionValue.refresh_token === 'string' ? sessionValue.refresh_token : undefined,
    user_id: typeof user?.id === 'string' ? user.id : undefined,
    email: typeof user?.email === 'string' ? user.email : null,
    expires_at: typeof sessionValue.expires_at === 'number' ? sessionValue.expires_at : undefined,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
