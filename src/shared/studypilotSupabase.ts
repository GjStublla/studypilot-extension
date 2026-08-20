import {
  DASHBOARD_URL,
  LOCAL_DEV_EMAIL,
  LOCAL_DEV_MODE,
  LOCAL_DEV_PASSWORD,
  STUDYPILOT_CONNECT_MESSAGE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './config';
import { titleForAction } from './studyActions';
import type {
  CoachingCommit,
  CoachingRequest,
  CoachingResponse,
  DashboardChatMessage,
  DashboardChatSummary,
  DashboardSaveResult,
  DashboardSessionSummary,
  ExtensionAuthSession,
  ExtensionAuthState,
  LiveTokenResult,
  SharedChatContext,
  StudyFolder,
  StudyPilotSessionMode,
  StudySession,
} from './types';

const STORAGE_KEY = 'studypilot_supabase_access_session';
const LEGACY_STORAGE_KEY = 'studypilot_supabase_session';
const ACTIVE_CHAT_STORAGE_PREFIX = 'studypilot_active_chat';
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

interface DashboardChatRow {
  id?: string;
  session_id?: string | null;
  title?: string;
  created_at?: string;
  updated_at?: string;
  rubric_id?: string | null;
}

interface RubricRow {
  id?: string;
  title?: string;
  file_search_status?: string | null;
}

interface DashboardSessionRow {
  id?: string;
  title?: string;
  source?: string | null;
  mode?: StudyPilotSessionMode;
  page_title?: string | null;
  page_url?: string | null;
  when_timestamp?: string;
}

interface DashboardChatMessageRow {
  id?: string;
  chat_id?: string;
  session_id?: string | null;
  role?: 'user' | 'ai' | 'system';
  text?: string;
  server_sequence?: number;
  request_id?: string | null;
  origin_surface?: 'dashboard' | 'extension' | 'legacy' | null;
  created_at?: string;
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

/** Access token for Edge calls from the service worker (Live bootstrap, etc.). */
export async function getAccessTokenForEdge(): Promise<string> {
  const session = await ensureAuthenticatedSession();
  return session.accessToken;
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
export async function requestLiveToken(sessionId?: string): Promise<LiveTokenResult> {
  const response = await edgeFetch('live-token', { sessionId });
  if (!response.ok) throw await responseError(response);

  const data = await response.json();
  if (data?.mode === 'text_fallback') {
    return {
      status: 'fallback',
      message: typeof data.reason === 'string'
        ? data.reason
        : 'Live coaching is unavailable; use text coaching.',
    };
  }
  if (data?.mode === 'proxy_required') {
    return {
      status: 'proxy_required',
      message: typeof data.reason === 'string'
        ? data.reason
        : 'Live coaching requires a backend WebSocket proxy.',
    };
  }
  if (typeof data?.accessToken === 'string' && typeof data?.webSocketUrl === 'string') {
    return {
      status: 'ready',
      webSocketUrl: data.webSocketUrl,
      tokenExpiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
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

export async function getSharedChatContext(): Promise<SharedChatContext> {
  const auth = await ensureAuthenticatedSession();
  const [chats, sessions] = await Promise.all([
    listDashboardChats(),
    listDashboardSessions(),
  ]);
  const storageKey = activeChatStorageKey(auth.userId);
  const storedChatId = await storageGet<string>(storageKey);
  const activeChatId = storedChatId && chats.some(chat => chat.id === storedChatId)
    ? storedChatId
    : null;

  if (storedChatId && !activeChatId) await storageRemove(storageKey);

  return {
    userId: auth.userId,
    chats,
    sessions,
    activeChatId,
  };
}

export async function getDashboardChatMessages(
  chatId: string,
): Promise<DashboardChatMessage[]> {
  const params = new URLSearchParams({
    select: 'id,chat_id,session_id,role,text,server_sequence,request_id,origin_surface,created_at',
    chat_id: `eq.${chatId}`,
    order: 'server_sequence.asc',
  });
  const response = await restFetch(`dashboard_chat_messages?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) throw await responseError(response);
  const rows = await parseJsonResponse<DashboardChatMessageRow[]>(response);
  return rows.map((row, index) => mapDashboardChatMessage(row, index));
}

export async function createDashboardChat(
  title: string,
  sessionId: string | null = null,
): Promise<DashboardChatSummary> {
  if (sessionId) return getOrCreateSessionChat(sessionId, title);

  const auth = await ensureAuthenticatedSession();
  const response = await restFetch('dashboard_chats?select=id,session_id,title,created_at,updated_at', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: auth.userId,
      title: normalizedChatTitle(title),
      origin_surface: 'extension',
    }),
  });

  if (!response.ok) throw await responseError(response);
  const rows = await parseJsonResponse<DashboardChatRow[]>(response);
  const chat = mapDashboardChat(rows[0]);
  await setActiveDashboardChat(chat.id);
  return chat;
}

export async function getOrCreateSessionChat(
  sessionId: string,
  title: string,
): Promise<DashboardChatSummary> {
  const response = await restFetch('rpc/get_or_create_session_chat', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      p_session_id: sessionId,
      p_title: normalizedChatTitle(title),
      p_origin_surface: 'extension',
    }),
  });

  if (!response.ok) throw await responseError(response);
  const raw = await parseJsonResponse<DashboardChatRow | DashboardChatRow[]>(response);
  const chat = mapDashboardChat(Array.isArray(raw) ? raw[0] : raw);
  await setActiveDashboardChat(chat.id);
  return chat;
}

export async function setActiveDashboardChat(chatId: string | null): Promise<void> {
  const auth = await ensureAuthenticatedSession();
  const storageKey = activeChatStorageKey(auth.userId);
  if (chatId) await storageSet(storageKey, chatId);
  else await storageRemove(storageKey);
}

async function listDashboardChats(): Promise<DashboardChatSummary[]> {
  const params = new URLSearchParams({
    select: 'id,session_id,title,created_at,updated_at,rubric_id',
    order: 'updated_at.desc,id.desc',
    limit: '50',
  });
  const response = await restFetch(`dashboard_chats?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await responseError(response);
  const chats = (await parseJsonResponse<DashboardChatRow[]>(response)).map(mapDashboardChat);
  return attachRubricMeta(chats);
}

async function attachRubricMeta(chats: DashboardChatSummary[]): Promise<DashboardChatSummary[]> {
  const rubricIds = [...new Set(chats.map(c => c.rubricId).filter((id): id is string => Boolean(id)))];
  if (rubricIds.length === 0) return chats;

  const params = new URLSearchParams({
    select: 'id,title,file_search_status',
    id: `in.(${rubricIds.join(',')})`,
  });
  const response = await restFetch(`rubrics?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return chats;

  const rows = await parseJsonResponse<RubricRow[]>(response);
  const byId = new Map(
    rows
      .filter((row): row is RubricRow & { id: string } => typeof row.id === 'string')
      .map(row => [row.id, row]),
  );

  return chats.map(chat => {
    if (!chat.rubricId) return chat;
    const rubric = byId.get(chat.rubricId);
    if (!rubric) return chat;
    const fileSearchStatus = rubric.file_search_status ?? null;
    return {
      ...chat,
      rubricTitle: rubric.title?.trim() || 'Rubric',
      rubricFileSearchStatus: fileSearchStatus,
      ragReady: fileSearchStatus === 'indexed',
    };
  });
}

async function listDashboardSessions(): Promise<DashboardSessionSummary[]> {
  const params = new URLSearchParams({
    select: 'id,title,source,mode,page_title,page_url,when_timestamp',
    order: 'when_timestamp.desc,id.desc',
    limit: '50',
  });
  const response = await restFetch(`sessions?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await responseError(response);
  return (await parseJsonResponse<DashboardSessionRow[]>(response)).map(mapDashboardSession);
}

export async function requestCoaching(
  request: CoachingRequest,
): Promise<CoachingResponse> {
  const response = await edgeFetch('socratic-coach', coachingRequestBody(request));

  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new Error('StudyPilot AI returned an empty stream.');

  const streamed = await parseCoachingSseStream(response.body, {
    chatId: request.chatId ?? '',
    requestId: request.requestId,
  });

  return {
    title: titleForAction(request.action, request.question),
    text: streamed.text.trim(),
    commit: streamed.commit,
  };
}

export function coachingRequestBody(request: CoachingRequest) {
  return {
    chatId: request.chatId,
    requestId: request.requestId,
    userMessage: request.userMessage,
    originSurface: request.originSurface,
    clientContext: request.clientContext,
    images: request.images ?? [],
  };
}

export async function parseCoachingSseStream(
  stream: ReadableStream<Uint8Array>,
  expected: { chatId: string; requestId: string },
): Promise<{ text: string; commit: CoachingCommit }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let commit: CoachingCommit | null = null;
  let doneReceived = false;

  const consumeLine = (line: string) => {
    const clean = line.trim();
    if (!clean.startsWith('data:')) return;

    const raw = clean.slice(5).trim();
    if (raw === '[DONE]') {
      if (!commit) {
        throw new Error('StudyPilot AI stream ended before the response was saved.');
      }
      doneReceived = true;
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (hasStringProperty(parsed, 'error')) throw new Error(parsed.error);
    if (isCoachingCommit(parsed)) {
      if (parsed.chatId !== expected.chatId || parsed.requestId !== expected.requestId) {
        throw new Error('StudyPilot AI returned a commit for a different request.');
      }
      commit = parsed;
      return;
    }

    // Token events remain compatible with the original `{ text }` stream.
    if (hasStringProperty(parsed, 'text')) text += parsed.text;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
    if (doneReceived) break;
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);
  if (!doneReceived || !commit) {
    throw new Error('StudyPilot AI stream closed before the response was committed.');
  }

  return { text, commit };
}

export async function syncStudySessionToSupabase(
  chatId: string,
  session: StudySession,
  finalize = false,
): Promise<DashboardSaveResult> {
  const auth = await ensureAuthenticatedSession();
  const chat = await getDashboardChat(chatId);
  const activeRubricId = chat.sessionId ? null : await getActiveRubricId(auth.userId);
  const remoteSessionId = chat.sessionId ?? chat.id;
  const screenshotPath = session.screenshotDataUrl
    ? await uploadSessionCapture(auth, remoteSessionId, session.screenshotDataUrl)
    : null;

  let savedRemoteSessionId = remoteSessionId;

  if (chat.sessionId) {
    if (screenshotPath) {
      const screenshotResponse = await restFetch(
        `sessions?id=eq.${encodeURIComponent(remoteSessionId)}&select=id`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ screenshot_path: screenshotPath }),
        },
      );
      if (!screenshotResponse.ok) throw await responseError(screenshotResponse);

      const savedSession = await parseJsonResponse<Array<{ id?: string }>>(screenshotResponse);
      if (savedSession[0]?.id !== remoteSessionId) {
        throw new Error('StudyPilot could not update the linked session capture.');
      }
    }
  } else {
    const sessionDetails: Record<string, unknown> = {
      duration_seconds: session.durationSeconds ?? durationFromTranscript(session.transcript),
      page_title: session.sourceTitle,
      page_url: session.sourceUrl,
    };
    if (screenshotPath) sessionDetails.screenshot_path = screenshotPath;

    const response = await restFetch('sessions?on_conflict=id&select=id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        ...sessionDetails,
        id: remoteSessionId,
        user_id: auth.userId,
        rubric_id: activeRubricId,
        title: session.title || session.sourceTitle || chat.title || 'StudyPilot session',
        source: 'Chrome Extension',
        mode: session.mode ?? modeForFolder(session.folder),
        when_timestamp: session.createdAt,
      }),
    });
    if (!response.ok) throw await responseError(response);

    const savedSession = await parseJsonResponse<Array<{ id?: string }>>(response);
    const createdSessionId = savedSession[0]?.id;
    if (!createdSessionId) throw new Error('StudyPilot session was saved without a dashboard id.');
    savedRemoteSessionId = createdSessionId;
  }

  if (!chat.sessionId) {
    const linkResponse = await restFetch(
      'rpc/link_dashboard_chat_session',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ p_chat_id: chat.id }),
      },
    );
    if (!linkResponse.ok) throw await responseError(linkResponse);
    const linkedRaw = await parseJsonResponse<DashboardChatRow | DashboardChatRow[]>(linkResponse);
    const linkedChat = Array.isArray(linkedRaw) ? linkedRaw[0] : linkedRaw;
    if (linkedChat?.session_id !== savedRemoteSessionId) {
      throw new Error('StudyPilot saved the session but could not link it to the selected chat.');
    }
  }

  const messages = buildSessionMessages(savedRemoteSessionId, session);

  if (messages.length > 0) {
    const messagesResponse = await restFetch('session_messages?on_conflict=id', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(messages),
    });

    if (!messagesResponse.ok) throw await responseError(messagesResponse);
  }

  const summary = finalize
    ? await summarizeSession(remoteSessionId).catch(error => ({
        warning: error instanceof Error ? error.message : 'Session summary failed.',
      }))
    : {};

  const savedStudySession: StudySession = {
    ...session,
    remoteSessionId: savedRemoteSessionId,
    screenshotPath: screenshotPath ?? undefined,
  };

  return {
    ok: true,
    session: savedStudySession,
    remoteSessionId: savedRemoteSessionId,
    dashboardUrl: dashboardChatUrl(chat.id),
    summary: 'summary' in summary ? summary.summary : undefined,
    actionItems: 'actionItems' in summary ? summary.actionItems : undefined,
    warning: 'warning' in summary ? summary.warning : undefined,
  };
}

async function getDashboardChat(chatId: string): Promise<DashboardChatSummary> {
  const params = new URLSearchParams({
    select: 'id,session_id,title,created_at,updated_at,rubric_id',
    id: `eq.${chatId}`,
    limit: '1',
  });
  const response = await restFetch(`dashboard_chats?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw await responseError(response);
  const rows = await parseJsonResponse<DashboardChatRow[]>(response);
  if (!rows[0]) throw new Error('The selected StudyPilot chat is no longer available.');
  const [chat] = await attachRubricMeta([mapDashboardChat(rows[0])]);
  return chat;
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

export function buildSessionMessages(remoteSessionId: string, session: StudySession) {
  const transcript = (session.transcript ?? [])
    .filter(turn => turn.text.trim().length > 0)
    .sort((a, b) => a.atSeconds - b.atSeconds);

  return transcript.map(turn => ({
    id: turn.id,
    session_id: remoteSessionId,
    role: turn.role,
    message_text: turn.text.trim(),
    time_offset_seconds: Math.max(0, Math.round(turn.atSeconds)),
  }));
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
  headers.set('x-upsert', 'true');

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

function hasStringProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return typeof value === 'object'
    && value !== null
    && key in value
    && typeof (value as Record<K, unknown>)[key] === 'string';
}

function isCoachingCommit(value: unknown): value is CoachingCommit & { type: 'commit' } {
  if (!isObject(value) || value.type !== 'commit') return false;
  return (
    typeof value.chatId === 'string'
    && typeof value.requestId === 'string'
    && typeof value.userMessageId === 'string'
    && typeof value.assistantMessageId === 'string'
    && typeof value.userSequence === 'number'
    && typeof value.assistantSequence === 'number'
  );
}

function mapDashboardChat(row: DashboardChatRow | undefined): DashboardChatSummary {
  if (!row?.id) throw new Error('StudyPilot returned an invalid dashboard chat.');
  return {
    id: row.id,
    sessionId: row.session_id ?? null,
    title: row.title?.trim() || 'New chat',
    createdAt: row.created_at ?? new Date(0).toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
    rubricId: row.rubric_id ?? null,
  };
}

function mapDashboardSession(row: DashboardSessionRow): DashboardSessionSummary {
  if (!row.id || !row.mode) throw new Error('StudyPilot returned an invalid dashboard session.');
  return {
    id: row.id,
    title: row.title?.trim() || 'Study session',
    source: row.source ?? null,
    mode: row.mode,
    pageTitle: row.page_title ?? null,
    pageUrl: row.page_url ?? null,
    whenTimestamp: row.when_timestamp ?? new Date(0).toISOString(),
  };
}

function mapDashboardChatMessage(
  row: DashboardChatMessageRow,
  fallbackSequence: number,
): DashboardChatMessage {
  if (!row.id || !row.chat_id || !row.role || typeof row.text !== 'string') {
    throw new Error('StudyPilot returned an invalid dashboard chat message.');
  }
  return {
    id: row.id,
    chatId: row.chat_id,
    sessionId: row.session_id ?? null,
    role: row.role,
    text: row.text,
    sequence: row.server_sequence ?? fallbackSequence + 1,
    requestId: row.request_id,
    originSurface: row.origin_surface,
    createdAt: row.created_at ?? new Date(0).toISOString(),
  };
}

function normalizedChatTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, ' ');
  return normalized.slice(0, 80) || 'New chat';
}

function activeChatStorageKey(userId: string): string {
  return `${ACTIVE_CHAT_STORAGE_PREFIX}:${userId}`;
}

export function dashboardChatUrl(chatId: string | null): string {
  const base = DASHBOARD_URL.split('#')[0];
  return chatId
    ? `${base}#dashboard?chat=${encodeURIComponent(chatId)}`
    : `${base}#dashboard`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
