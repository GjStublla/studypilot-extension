import {
  LOCAL_DEV_EMAIL,
  LOCAL_DEV_MODE,
  LOCAL_DEV_PASSWORD,
  STUDYPILOT_CONNECT_MESSAGE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './config';
import type { ExtensionAuthSession, ExtensionAuthState } from './types';

const STORAGE_KEY = 'studypilot_supabase_access_session';
const LEGACY_STORAGE_KEY = 'studypilot_supabase_session';
const EXPIRY_SKEW_SECONDS = 30;
let localSessionInFlight: Promise<AuthenticatedSession> | null = null;
let validatedLocalSession: AuthenticatedSession | null = null;

class ExtensionAuthRequiredError extends Error {
  constructor(message = STUDYPILOT_CONNECT_MESSAGE) {
    super(message);
    this.name = 'ExtensionAuthRequiredError';
  }
}

export interface AuthenticatedSession {
  accessToken: string;
  userId: string;
  email?: string | null;
  expiresAt?: number;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
  iss?: string;
}

interface LocalAuthResponse {
  access_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: {
    id?: string;
    email?: string | null;
  };
  error?: string;
  error_description?: string;
  message?: string;
  msg?: string;
}

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  }
}

function chromeStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

export function storageGet<T>(key: string): Promise<T | null> {
  if (!chromeStorageAvailable()) return Promise.resolve(null);

  return new Promise(resolve => {
    chrome.storage.local.get(key, result => {
      resolve((result[key] as T | undefined) ?? null);
    });
  });
}

export function storageSet<T>(key: string, value: T): Promise<void> {
  if (!chromeStorageAvailable()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

export function storageRemove(key: string): Promise<void> {
  if (!chromeStorageAvailable()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

async function readStoredSession(): Promise<ExtensionAuthSession | null> {
  const stored = await storageGet<ExtensionAuthSession>(STORAGE_KEY);
  if (stored?.access_token) return stored;

  const legacyStored = await storageGet<ExtensionAuthSession>(LEGACY_STORAGE_KEY);
  if (!legacyStored?.access_token) return null;

  await storageRemove(LEGACY_STORAGE_KEY);
  const normalized = normalizeSession(legacyStored);
  const nextSession: ExtensionAuthSession = {
    access_token: normalized.accessToken,
    user_id: normalized.userId,
    email: normalized.email,
    expires_at: normalized.expiresAt,
  };

  await writeStoredSession(nextSession);
  return nextSession;
}

async function writeStoredSession(session: ExtensionAuthSession): Promise<void> {
  await storageSet(STORAGE_KEY, session);
}

/** Access token for Edge calls from the service worker (Live bootstrap, etc.). */
export async function getAccessTokenForEdge(): Promise<string> {
  const session = await ensureAuthenticatedSession();
  return session.accessToken;
}

export async function ensureAuthenticatedSession(): Promise<AuthenticatedSession> {
  assertConfigured();

  if (LOCAL_DEV_MODE && validatedLocalSession) {
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof validatedLocalSession.expiresAt !== 'number' ||
      validatedLocalSession.expiresAt > now + EXPIRY_SKEW_SECONDS
    ) {
      return validatedLocalSession;
    }
    validatedLocalSession = null;
  }

  const stored = await readStoredSession();
  if (stored) {
    try {
      const normalized = normalizeSession(stored);
      if (!LOCAL_DEV_MODE) {
        return normalized;
      }
      if (
        isConfiguredLocalSession(stored) &&
        await validateLocalAccessToken(normalized.accessToken)
      ) {
        validatedLocalSession = normalized;
        return normalized;
      }
      await storageRemove(STORAGE_KEY);
      await storageRemove(LEGACY_STORAGE_KEY);
    } catch (error) {
      await storageRemove(STORAGE_KEY);
      await storageRemove(LEGACY_STORAGE_KEY);
      if (!LOCAL_DEV_MODE) throw error;
    }
  }

  if (LOCAL_DEV_MODE) return ensureLocalDevSession();
  throw new ExtensionAuthRequiredError();
}

async function validateLocalAccessToken(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isConfiguredLocalSession(session: ExtensionAuthSession): boolean {
  const payload = decodeJwtPayload(session.access_token);
  return (
    (session.email ?? payload?.email) === LOCAL_DEV_EMAIL &&
    payload?.iss === `${SUPABASE_URL}/auth/v1`
  );
}

function ensureLocalDevSession(): Promise<AuthenticatedSession> {
  if (localSessionInFlight) return localSessionInFlight;

  localSessionInFlight = createLocalDevSession().finally(() => {
    localSessionInFlight = null;
  });

  return localSessionInFlight;
}

async function createLocalDevSession(): Promise<AuthenticatedSession> {
  const signIn = await localAuthFetch('token?grant_type=password', {
    email: LOCAL_DEV_EMAIL,
    password: LOCAL_DEV_PASSWORD,
  });

  let session = sessionFromLocalAuth(signIn.data);

  if (!session) {
    const signUp = await localAuthFetch('signup', {
      email: LOCAL_DEV_EMAIL,
      password: LOCAL_DEV_PASSWORD,
      data: {
        name: 'Local Developer',
        initials: 'LD',
      },
    });
    session = sessionFromLocalAuth(signUp.data);

    if (!session) {
      // The dashboard may have created the shared local user concurrently.
      const retry = await localAuthFetch('token?grant_type=password', {
        email: LOCAL_DEV_EMAIL,
        password: LOCAL_DEV_PASSWORD,
      });
      session = sessionFromLocalAuth(retry.data);

      if (!session) {
        throw new Error(
          `Local Supabase authentication failed: ${
            localAuthError(retry.data) ??
            localAuthError(signUp.data) ??
            localAuthError(signIn.data) ??
            'no session returned'
          }`,
        );
      }
    }
  }

  await writeStoredSession(session);
  validatedLocalSession = normalizeSession(session);
  return validatedLocalSession;
}

async function localAuthFetch(
  path: string,
  body: Record<string, unknown>,
): Promise<{ data: LocalAuthResponse }> {
  let response: Response;

  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Local Supabase is unavailable: ${detail}`);
  }

  let data: LocalAuthResponse = {};
  try {
    data = await response.json() as LocalAuthResponse;
  } catch {
    // The final retry below reports a stable error if no session is present.
  }

  return { data };
}

function sessionFromLocalAuth(data: LocalAuthResponse): ExtensionAuthSession | null {
  if (!data.access_token || !data.user?.id) return null;

  return {
    access_token: data.access_token,
    user_id: data.user.id,
    email: data.user.email ?? LOCAL_DEV_EMAIL,
    expires_at:
      data.expires_at ??
      (typeof data.expires_in === 'number'
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : undefined),
  };
}

function localAuthError(data: LocalAuthResponse): string | null {
  return data.error_description ?? data.message ?? data.msg ?? data.error ?? null;
}

function normalizeSession(session: ExtensionAuthSession): AuthenticatedSession {
  if (!session.access_token) {
    throw new ExtensionAuthRequiredError();
  }

  const payload = decodeJwtPayload(session.access_token);
  const userId = session.user_id ?? payload?.sub;
  const expiresAt = session.expires_at ?? payload?.exp;
  const now = Math.floor(Date.now() / 1000);

  if (typeof expiresAt === 'number' && expiresAt <= now + EXPIRY_SKEW_SECONDS) {
    throw new ExtensionAuthRequiredError(
      'StudyPilot session expired. Open the dashboard while signed in to reconnect the extension.',
    );
  }

  if (!userId) {
    throw new ExtensionAuthRequiredError('StudyPilot session could not be validated.');
  }

  return {
    accessToken: session.access_token,
    userId,
    email: session.email ?? payload?.email ?? null,
    expiresAt,
  };
}

function decodeJwtPayload(token: string): JwtPayload | null {
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

export function authHeaders(session: AuthenticatedSession): Headers {
  const headers = new Headers();
  headers.set('apikey', SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  return headers;
}

export async function edgeFetch(functionName: string, body: unknown): Promise<Response> {
  const session = await ensureAuthenticatedSession();
  const headers = authHeaders(session);
  headers.set('Content-Type', 'application/json');

  return fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await ensureAuthenticatedSession();
  const headers = authHeaders(session);
  const providedHeaders = new Headers(init.headers);

  providedHeaders.forEach((value, key) => headers.set(key, value));
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers,
  });
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(response.statusText || `Request failed with ${response.status}`);
  }
}

export async function responseError(response: Response): Promise<Error> {
  try {
    const data = await response.json();
    const message =
      typeof data?.error === 'string'
        ? data.error
        : typeof data?.message === 'string'
          ? data.message
          : response.statusText;
    return new Error(message || `Request failed with ${response.status}`);
  } catch {
    return new Error(response.statusText || `Request failed with ${response.status}`);
  }
}

export async function storeExtensionSession(
  session: ExtensionAuthSession,
): Promise<ExtensionAuthState> {
  const normalized = normalizeSession(session);

  await writeStoredSession({
    access_token: normalized.accessToken,
    user_id: normalized.userId,
    email: normalized.email,
    expires_at: normalized.expiresAt,
  });

  await storageRemove(LEGACY_STORAGE_KEY);
  return {
    connected: true,
    userId: normalized.userId,
    email: normalized.email,
  };
}

export async function clearExtensionSession(): Promise<ExtensionAuthState> {
  validatedLocalSession = null;
  await storageRemove(STORAGE_KEY);
  await storageRemove(LEGACY_STORAGE_KEY);
  return { connected: false };
}

export async function getAuthStatus(): Promise<ExtensionAuthState> {
  try {
    const session = await ensureAuthenticatedSession();
    return {
      connected: true,
      userId: session.userId,
      email: session.email,
    };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : STUDYPILOT_CONNECT_MESSAGE,
    };
  }
}

/** Legacy live-token endpoint retained for clients that still use the proxy flow. */
