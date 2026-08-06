import {
  DASHBOARD_URL,
  LOCAL_DEV_EMAIL,
  LOCAL_DEV_MODE,
  LOCAL_DEV_PASSWORD,
  STUDYPILOT_CONNECT_MESSAGE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './config';
import { defaultPromptForAction, titleForAction } from './studyActions';
import type {
  CoachingRequest,
  CoachingResponse,
  DashboardSaveResult,
  ExtensionAuthSession,
  ExtensionAuthState,
  LiveTokenResult,
  StudyFolder,
  StudyPilotSessionMode,
  StudySession,
} from './types';

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

interface AuthenticatedSession {
  accessToken: string;
  refreshToken?: string;
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

interface SummarizeSessionResult {
  summary?: string;
  actionItems?: string[];
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

function storageGet<T>(key: string): Promise<T | null> {
  if (!chromeStorageAvailable()) return Promise.resolve(null);

  return new Promise(resolve => {
    chrome.storage.local.get(key, result => {
      resolve((result[key] as T | undefined) ?? null);
    });
  });
}

function storageSet<T>(key: string, value: T): Promise<void> {
  if (!chromeStorageAvailable()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function storageRemove(key: string): Promise<void> {
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

  // Migrate legacy session to the current storage key.
  // Wrap normalizeSession in try/catch — an expired legacy token should be
  // silently discarded rather than throwing during the migration path.
  await storageRemove(LEGACY_STORAGE_KEY);
  try {
    const normalized = normalizeSession(legacyStored);
    const nextSession: ExtensionAuthSession = {
      access_token: normalized.accessToken,
      user_id: normalized.userId,
      email: normalized.email,
      expires_at: normalized.expiresAt,
    };
    await writeStoredSession(nextSession);
    return nextSession;
  } catch {
    // Legacy token is expired — don't migrate it, treat as no session.
    return null;
  }
}

async function writeStoredSession(session: ExtensionAuthSession): Promise<void> {
  await storageSet(STORAGE_KEY, session);
}

async function ensureAuthenticatedSession(): Promise<AuthenticatedSession> {
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
    } catch (err) {
      // Token expired — attempt a silent refresh via Supabase before giving up.
      if (stored.access_token && !LOCAL_DEV_MODE) {
        const refreshed = await attemptTokenRefresh(stored);
        if (refreshed) return refreshed;
      }
      await storageRemove(STORAGE_KEY);
      await storageRemove(LEGACY_STORAGE_KEY);
      if (!LOCAL_DEV_MODE) throw err;
    }
  }

  if (LOCAL_DEV_MODE) return ensureLocalDevSession();
  throw new ExtensionAuthRequiredError();
}

/**
 * Attempt a silent token refresh using the stored refresh token.
 * Falls back to a clock-skew validation if no refresh token is available.
 * Returns a new valid session, or null if the token is genuinely expired.
 */
async function attemptTokenRefresh(stored: ExtensionAuthSession): Promise<AuthenticatedSession | null> {
  // Prefer a real refresh if we have a refresh token.
  if (stored.refresh_token) {
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: stored.refresh_token }),
      });

      if (response.ok) {
        const data = await response.json() as {
          access_token?: string;
          refresh_token?: string;
          expires_at?: number;
          expires_in?: number;
          user?: { id?: string; email?: string | null };
        };

        if (data.access_token && data.user?.id) {
          const renewed: ExtensionAuthSession = {
            access_token: data.access_token,
            refresh_token: data.refresh_token ?? stored.refresh_token,
            user_id: data.user.id,
            email: data.user.email ?? stored.email,
            expires_at:
              data.expires_at ??
              (typeof data.expires_in === 'number'
                ? Math.floor(Date.now() / 1000) + data.expires_in
                : undefined),
          };
          await writeStoredSession(renewed);
          return normalizeSession(renewed);
        }
      }
    } catch {
      // Network error — fall through to clock-skew check.
    }
  }

  // No refresh token or refresh failed — check if the token is still accepted
  // by Supabase (handles clock skew between the extension and server).
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${stored.access_token}`,
      },
    });

    if (response.ok) {
      // Token still valid — extend local expiry by 5 minutes.
      const extended: ExtensionAuthSession = {
        ...stored,
        expires_at: Math.floor(Date.now() / 1000) + 300,
      };
      await writeStoredSession(extended);
      return normalizeSession(extended);
    }
  } catch {
    // Network error.
  }

  return null;
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
    refreshToken: session.refresh_token,
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

function authHeaders(session: AuthenticatedSession): Headers {
  const headers = new Headers();
  headers.set('apikey', SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  return headers;
}

async function edgeFetch(functionName: string, body: unknown): Promise<Response> {
  const session = await ensureAuthenticatedSession();
  const headers = authHeaders(session);
  headers.set('Content-Type', 'application/json');

  return fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
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

async function parseJsonResponse<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(response.statusText || `Request failed with ${response.status}`);
  }
}

async function responseError(response: Response): Promise<Error> {
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
    refresh_token: session.refresh_token, // preserve refresh token for silent renewal
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

export async function requestLiveToken(sessionId?: string): Promise<LiveTokenResult> {
  const response = await edgeFetch('live-token', { sessionId });
  if (!response.ok) throw await responseError(response);

  const data = await response.json();

  if (data?.mode === 'text_fallback') {
    return {
      status: 'fallback',
      message: typeof data.reason === 'string' ? data.reason : 'Live coaching is unavailable; use text coaching.',
    };
  }

  if (data?.mode === 'proxy_required') {
    return {
      status: 'proxy_required',
      message: typeof data.reason === 'string' ? data.reason : 'Live coaching requires a backend WebSocket proxy.',
    };
  }

  if (typeof data?.accessToken === 'string' && typeof data?.webSocketUrl === 'string') {
    return {
      status: 'ready',
      webSocketUrl: data.webSocketUrl,
      tokenExpiresAt: data.expiresAt,
      message: 'Live token ready.',
    };
  }

  if (typeof data?.ephemeralToken === 'string') {
    return {
      status: 'stub',
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
      message: 'The live-token function returned a stub token. Text coaching is available; live audio awaits the real token endpoint.',
    };
  }

  throw new Error('Unexpected live-token response from StudyPilot.');
}

export async function requestCoaching(
  request: CoachingRequest,
): Promise<CoachingResponse> {
  const response = await edgeFetch('socratic-coach', {
    ...(request.chatId ? { chatId: request.chatId } : {}),
    requestId: request.requestId,
    userMessage: buildCoachingMessage(request),
    images: request.images ?? [],
  });

  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error('StudyPilot AI returned an empty stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let commit: import('./types').CoachingCommit | null = null;

  const fallbackCommit = (): import('./types').CoachingCommit => ({
    chatId: request.chatId ?? '',
    requestId: request.requestId,
    userMessageId: crypto.randomUUID(),
    assistantMessageId: crypto.randomUUID(),
    userSequence: 0,
    assistantSequence: 1,
  });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const clean = line.trim();
      if (!clean.startsWith('data: ')) continue;

      const raw = clean.slice(6).trim();
      if (raw === '[DONE]') {
        return {
          title: titleForAction(request.action, request.question),
          text: text.trim(),
          commit: commit ?? fallbackCommit(),
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      if (hasStringProperty(parsed, 'error')) throw new Error(parsed.error);
      if (hasStringProperty(parsed, 'text')) text += parsed.text;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'commit' in parsed &&
        parsed.commit &&
        typeof parsed.commit === 'object'
      ) {
        commit = parsed.commit as import('./types').CoachingCommit;
      }
    }
  }

  return {
    title: titleForAction(request.action, request.question),
    text: text.trim(),
    commit: commit ?? fallbackCommit(),
  };
}

export async function importStudySessionToSupabase(
  session: StudySession,
): Promise<DashboardSaveResult> {
  const auth = await ensureAuthenticatedSession();
  const activeRubricId = await getActiveRubricId(auth.userId);
  const remoteSessionId = session.remoteSessionId ?? session.id ?? crypto.randomUUID();
  const screenshotPath = session.screenshotDataUrl
    ? await uploadSessionCapture(auth, remoteSessionId, session.screenshotDataUrl)
    : null;

  const response = await restFetch('sessions?select=id', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: remoteSessionId,
      user_id: auth.userId,
      rubric_id: activeRubricId,
      title: session.title || session.sourceTitle || 'StudyPilot session',
      source: 'Chrome Extension',
      mode: session.mode ?? modeForFolder(session.folder),
      duration_seconds: session.durationSeconds ?? durationFromTranscript(session.transcript),
      page_title: session.sourceTitle,
      page_url: session.sourceUrl,
      screenshot_path: screenshotPath,
      when_timestamp: session.createdAt,
    }),
  });

  if (!response.ok) throw await responseError(response);

  const savedSession = await parseJsonResponse<Array<{ id?: string }>>(response);
  const savedRemoteSessionId = savedSession[0]?.id;
  if (!savedRemoteSessionId) throw new Error('StudyPilot session was saved without a dashboard id.');

  const messages = buildSessionMessages(savedRemoteSessionId, session);

  if (messages.length > 0) {
    const messagesResponse = await restFetch('session_messages', {
      method: 'POST',
      headers: {
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(messages),
    });

    if (!messagesResponse.ok) throw await responseError(messagesResponse);
  }

  const summary = await summarizeSession(remoteSessionId).catch(error => ({
    warning: error instanceof Error ? error.message : 'Session summary failed.',
  }));

  const savedStudySession: StudySession = {
    ...session,
    remoteSessionId: savedRemoteSessionId,
    screenshotPath: screenshotPath ?? undefined,
  };

  return {
    ok: true,
    session: savedStudySession,
    remoteSessionId: savedRemoteSessionId,
    dashboardUrl: `${DASHBOARD_URL}/${savedRemoteSessionId}`,
    summary: 'summary' in summary ? summary.summary : undefined,
    actionItems: 'actionItems' in summary ? summary.actionItems : undefined,
    warning: 'warning' in summary ? summary.warning : undefined,
  };
}

async function getActiveRubricId(userId: string): Promise<string | null> {
  const params = new URLSearchParams({
    select: 'id',
    user_id: `eq.${userId}`,
    active: 'is.true',
    limit: '1',
  });
  const response = await restFetch(`rubrics?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) return null;

  const data = await parseJsonResponse<Array<{ id?: string }>>(response);
  return typeof data[0]?.id === 'string' ? data[0].id : null;
}

async function summarizeSession(sessionId: string): Promise<SummarizeSessionResult> {
  const response = await edgeFetch('summarize-session', { sessionId });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

function modeForFolder(folder: StudyFolder): StudyPilotSessionMode {
  if (/presentation/i.test(folder)) return 'Presentation Coach';
  if (/lecture/i.test(folder)) return 'Lecture';
  if (/research|reader/i.test(folder)) return 'Research Reader';
  if (/essay|writing/i.test(folder)) return 'Essay Coach';
  return 'Study Coach';
}

function buildCoachingMessage(request: CoachingRequest): string {
  const selectedText =
    request.context.selectedText && request.page.selectedText
      ? request.page.selectedText
      : null;
  const screenshotNote = request.context.screenshot
    ? 'The student shared a current screenshot with this request. Use it as visual context when relevant.'
    : 'The student did not share a screenshot.';
  const pageUrl = request.context.pageUrl ? request.page.sourceUrl : 'not shared';

  const parts = [
    'StudyPilot extension request.',
    `Action: ${labelForAction(request.action)}.`,
    `Page title: ${request.page.sourceTitle || 'unknown'}.`,
    `Page URL: ${pageUrl}.`,
    `Selected text: ${selectedText || 'none shared'}.`,
    screenshotNote,
    'Academic-integrity rule: coach the student with explanations, questions, study strategies, and revision guidance. Do not write final submission-ready assignment content.',
    `Student request: ${request.question?.trim() || defaultPromptForAction(request.action)}.`,
  ];

  // Include the extracted page text so the AI can actually read what the student sees.
  if (request.page.pageText) {
    parts.push(`\nPAGE CONTENT (first ~6000 chars):\n${request.page.pageText}`);
  }

  return parts.join('\n');
}

function buildSessionMessages(remoteSessionId: string, session: StudySession) {
  const transcript = (session.transcript ?? [])
    .filter(turn => turn.text.trim().length > 0)
    .sort((a, b) => a.atSeconds - b.atSeconds);

  if (transcript.length > 0) {
    return transcript.map(turn => ({
      session_id: remoteSessionId,
      role: turn.role,
      message_text: turn.text.trim(),
      time_offset_seconds: Math.max(0, Math.round(turn.atSeconds)),
    }));
  }

  return [
    {
      session_id: remoteSessionId,
      role: 'user',
      message_text: session.question,
      time_offset_seconds: 0,
    },
    {
      session_id: remoteSessionId,
      role: 'ai',
      message_text: session.answer,
      time_offset_seconds: 1,
    },
  ].filter(message => message.message_text.trim().length > 0);
}

function durationFromTranscript(transcript?: StudySession['transcript']): number {
  if (!transcript || transcript.length === 0) return 0;
  return Math.max(...transcript.map(turn => Math.max(0, Math.round(turn.atSeconds))));
}

async function uploadSessionCapture(
  auth: AuthenticatedSession,
  sessionId: string,
  dataUrl: string,
): Promise<string> {
  const image = parseImageDataUrl(dataUrl);
  const path = `${auth.userId}/${sessionId}/capture.jpg`;
  const headers = authHeaders(auth);
  headers.set('Content-Type', image.mimeType);

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/session-captures/${encodeStoragePath(path)}`,
    {
      method: 'POST',
      headers,
      body: base64ToBlob(image.data, image.mimeType),
    },
  );

  if (!response.ok) throw await responseError(response);
  return path;
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:(image\/jpeg);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error('Dashboard screenshot capture must be a JPEG image.');

  return {
    mimeType: match[1].toLowerCase(),
    data: match[2],
  };
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function encodeStoragePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function labelForAction(action: CoachingRequest['action']): string {
  switch (action) {
    case 'summarize':
      return 'summarize the current study material';
    case 'quiz':
      return 'ask a short formative quiz';
    case 'flashcards':
      return 'draft study flashcards from the context';
    case 'explain':
    default:
      return 'explain or coach';
  }
}

function hasStringProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return typeof value === 'object'
    && value !== null
    && key in value
    && typeof (value as Record<K, unknown>)[key] === 'string';
}

// ─── Dashboard chat functions ─────────────────────────────────────────────────

export async function getSharedChatContext(): Promise<import('./types').SharedChatContext> {
  const auth = await ensureAuthenticatedSession();

  const [chatsResp, sessionsResp, activeResp] = await Promise.all([
    restFetch(
      `chats?select=id,session_id,title,created_at,updated_at&user_id=eq.${auth.userId}&order=updated_at.desc&limit=50`,
      { headers: { Accept: 'application/json' } },
    ),
    restFetch(
      `sessions?select=id,title,source,mode,page_title,page_url,when_timestamp&user_id=eq.${auth.userId}&order=when_timestamp.desc&limit=50`,
      { headers: { Accept: 'application/json' } },
    ),
    restFetch(
      `user_preferences?select=active_chat_id&user_id=eq.${auth.userId}&limit=1`,
      { headers: { Accept: 'application/json' } },
    ),
  ]);

  const chatsRaw = chatsResp.ok
    ? await parseJsonResponse<Array<{ id: string; session_id: string | null; title: string; created_at: string; updated_at: string }>>(chatsResp)
    : [];

  const sessionsRaw = sessionsResp.ok
    ? await parseJsonResponse<Array<{ id: string; title: string; source: string | null; mode: string; page_title: string | null; page_url: string | null; when_timestamp: string }>>(sessionsResp)
    : [];

  const prefsRaw = activeResp.ok
    ? await parseJsonResponse<Array<{ active_chat_id: string | null }>>(activeResp)
    : [];

  const chats: import('./types').DashboardChatSummary[] = chatsRaw.map(c => ({
    id: c.id,
    sessionId: c.session_id,
    title: c.title,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  const sessions: import('./types').DashboardSessionSummary[] = sessionsRaw.map(s => ({
    id: s.id,
    title: s.title,
    source: s.source,
    mode: (s.mode as import('./types').StudyPilotSessionMode) ?? 'Study Coach',
    pageTitle: s.page_title,
    pageUrl: s.page_url,
    whenTimestamp: s.when_timestamp,
  }));

  return {
    userId: auth.userId,
    chats,
    sessions,
    activeChatId: prefsRaw[0]?.active_chat_id ?? null,
  };
}

export async function getDashboardChatMessages(chatId: string): Promise<import('./types').DashboardChatMessage[]> {
  const response = await restFetch(
    `chat_messages?select=id,chat_id,session_id,role,text,sequence,request_id,origin_surface,created_at&chat_id=eq.${encodeURIComponent(chatId)}&order=sequence.asc`,
    { headers: { Accept: 'application/json' } },
  );

  if (!response.ok) throw await responseError(response);

  const raw = await parseJsonResponse<Array<{
    id: string;
    chat_id: string;
    session_id: string | null;
    role: string;
    text: string;
    sequence: number;
    request_id?: string | null;
    origin_surface?: string | null;
    created_at: string;
  }>>(response);

  return raw.map(m => ({
    id: m.id,
    chatId: m.chat_id,
    sessionId: m.session_id,
    role: m.role as 'user' | 'ai' | 'system',
    text: m.text,
    sequence: m.sequence,
    requestId: m.request_id,
    originSurface: m.origin_surface as import('./types').DashboardChatMessage['originSurface'],
    createdAt: m.created_at,
  }));
}

export async function createDashboardChat(
  title: string,
  sessionId: string | null,
): Promise<import('./types').DashboardChatSummary> {
  const auth = await ensureAuthenticatedSession();

  const response = await restFetch('chats?select=id,session_id,title,created_at,updated_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: auth.userId,
      session_id: sessionId,
      title,
    }),
  });

  if (!response.ok) throw await responseError(response);

  const rows = await parseJsonResponse<Array<{
    id: string;
    session_id: string | null;
    title: string;
    created_at: string;
    updated_at: string;
  }>>(response);

  const row = rows[0];
  if (!row) throw new Error('Chat was not created.');

  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrCreateSessionChat(
  sessionId: string,
  title: string,
): Promise<import('./types').DashboardChatSummary> {
  const auth = await ensureAuthenticatedSession();

  // Check for an existing chat linked to this session.
  const existing = await restFetch(
    `chats?select=id,session_id,title,created_at,updated_at&user_id=eq.${auth.userId}&session_id=eq.${encodeURIComponent(sessionId)}&limit=1`,
    { headers: { Accept: 'application/json' } },
  );

  if (existing.ok) {
    const rows = await parseJsonResponse<Array<{
      id: string;
      session_id: string | null;
      title: string;
      created_at: string;
      updated_at: string;
    }>>(existing);

    if (rows[0]) {
      return {
        id: rows[0].id,
        sessionId: rows[0].session_id,
        title: rows[0].title,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      };
    }
  }

  return createDashboardChat(title, sessionId);
}

export async function setActiveDashboardChat(chatId: string | null): Promise<void> {
  const auth = await ensureAuthenticatedSession();

  await restFetch('user_preferences', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: auth.userId,
      active_chat_id: chatId,
    }),
  });
}

/**
 * Save (or incrementally update) a study session to the dashboard.
 * This wraps `importStudySessionToSupabase` but also accepts a `chatId`
 * for chat-linked sessions.
 */
export async function syncStudySessionToSupabase(
  _chatId: string,
  session: StudySession,
  _finalize = false,
): Promise<DashboardSaveResult> {
  return importStudySessionToSupabase({ ...session, remoteSessionId: session.remoteSessionId });
}
