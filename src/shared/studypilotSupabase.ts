import {
  AUTH_REQUIRED,
  DASHBOARD_URL,
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

const DEV_AUTH_STATE: ExtensionAuthState = {
  connected: true,
  userId: 'dev-user',
  email: 'dev@studypilot.local',
};

class ExtensionAuthRequiredError extends Error {
  constructor(message = STUDYPILOT_CONNECT_MESSAGE) {
    super(message);
    this.name = 'ExtensionAuthRequiredError';
  }
}

interface AuthenticatedSession {
  accessToken: string;
  userId: string;
  email?: string | null;
  expiresAt?: number;
}

interface JwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
}

interface SummarizeSessionResult {
  summary?: string;
  actionItems?: string[];
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

async function ensureAuthenticatedSession(): Promise<AuthenticatedSession> {
  assertConfigured();

  const stored = await readStoredSession();
  if (!stored) {
    if (!AUTH_REQUIRED) {
      throw new ExtensionAuthRequiredError(
        'Dev mode: no dashboard session yet. UI is unlocked; connect a real session for live AI and saves.',
      );
    }
    throw new ExtensionAuthRequiredError();
  }

  try {
    return normalizeSession(stored);
  } catch (error) {
    await storageRemove(STORAGE_KEY);
    await storageRemove(LEGACY_STORAGE_KEY);
    if (!AUTH_REQUIRED) {
      throw new ExtensionAuthRequiredError(
        'Dev mode: stored session invalid. UI is unlocked; reconnect from the dashboard for live AI and saves.',
      );
    }
    throw error;
  }
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
    if (!AUTH_REQUIRED) return DEV_AUTH_STATE;

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
  try {
    return await requestCoachingAuthenticated(request);
  } catch (error) {
    if (!AUTH_REQUIRED && error instanceof ExtensionAuthRequiredError) {
      return {
        title: titleForAction(request.action, request.question),
        text:
          'Dev mode (auth disabled): the panel is unlocked without a dashboard session. ' +
          'Connect StudyPilot from the dashboard to get live AI coaching.',
      };
    }
    throw error;
  }
}

async function requestCoachingAuthenticated(
  request: CoachingRequest,
): Promise<CoachingResponse> {
  const response = await edgeFetch('socratic-coach', {
    sessionId: request.sessionId,
    userMessage: buildCoachingMessage(request),
    history: request.history ?? [],
    images: request.images ?? [],
  });

  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error('StudyPilot AI returned an empty stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

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
    }
  }

  return {
    title: titleForAction(request.action, request.question),
    text: text.trim(),
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

  return [
    'StudyPilot extension request.',
    `Action: ${labelForAction(request.action)}.`,
    `Page title: ${request.page.sourceTitle || 'unknown'}.`,
    `Page URL: ${pageUrl}.`,
    `Selected text: ${selectedText || 'none shared'}.`,
    screenshotNote,
    'Academic-integrity rule: coach the student with explanations, questions, study strategies, and revision guidance. Do not write final submission-ready assignment content.',
    `Student request: ${request.question?.trim() || defaultPromptForAction(request.action)}.`,
  ].join('\n');
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
