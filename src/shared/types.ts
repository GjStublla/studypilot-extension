export const STUDY_FOLDERS = ['Biology 101', 'History Midterm', 'Programming Assignment'] as const;

export type StudyFolder = (typeof STUDY_FOLDERS)[number];

export type StudyPhase = 'idle' | 'thinking' | 'answer' | 'saved';

export type StudyAction = 'explain' | 'summarize' | 'quiz' | 'flashcards';

export type StudyPilotSessionMode =
  'Essay Coach' | 'Presentation Coach' | 'Study Coach' | 'Lecture' | 'Research Reader';

export interface PageContext {
  sourceUrl: string;
  sourceTitle: string;
  host: string;
  selectedText?: string;
  /** Extracted readable text from the page body (capped at ~6000 chars). */
  pageText?: string;
}

export interface ContextShareSettings {
  screenshot: boolean;
  pageUrl: boolean;
  selectedText: boolean;
  saveToDashboard: boolean;
  folder: StudyFolder;
}

/** Live-session capture and persistence choices. Independent of page URL / selected text. */
export interface SessionPrivacyOptions {
  captureScreenshot: boolean;
  saveToDashboard: boolean;
}

export const DEFAULT_SESSION_PRIVACY: SessionPrivacyOptions = {
  captureScreenshot: false,
  saveToDashboard: false,
};

export const DEFAULT_CONTEXT_SHARE_SETTINGS: ContextShareSettings = {
  screenshot: DEFAULT_SESSION_PRIVACY.captureScreenshot,
  pageUrl: true,
  selectedText: false,
  saveToDashboard: DEFAULT_SESSION_PRIVACY.saveToDashboard,
  folder: 'Biology 101',
};

export function isSessionPrivacyOptions(value: unknown): value is SessionPrivacyOptions {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.captureScreenshot === 'boolean' && typeof record.saveToDashboard === 'boolean';
}

export function sessionPrivacyFromContext(
  context: Pick<ContextShareSettings, 'screenshot' | 'saveToDashboard'>,
): SessionPrivacyOptions {
  return {
    captureScreenshot: context.screenshot,
    saveToDashboard: context.saveToDashboard,
  };
}

export interface StudySession {
  id: string;
  title: string;
  sourceUrl: string;
  sourceTitle: string;
  screenshotUrl?: string;
  screenshotDataUrl?: string;
  screenshotPath?: string;
  question: string;
  answer: string;
  transcript?: StudyTranscriptTurn[];
  folder: StudyFolder;
  mode?: StudyPilotSessionMode;
  durationSeconds?: number;
  remoteSessionId?: string;
  createdAt: string;
  tags: string[];
}

export interface DashboardSaveResult {
  ok: true;
  session: StudySession;
  dashboardUrl: string;
  remoteSessionId?: string;
  summary?: string;
  actionItems?: string[];
  warning?: string;
}

export interface DashboardChatSummary {
  id: string;
  sessionId: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
  rubricId?: string | null;
  rubricTitle?: string | null;
  rubricFileSearchStatus?: string | null;
  ragReady?: boolean;
}

export interface DashboardSessionSummary {
  id: string;
  title: string;
  source: string | null;
  mode: StudyPilotSessionMode;
  pageTitle: string | null;
  pageUrl: string | null;
  whenTimestamp: string;
}

export interface DashboardChatMessage {
  id: string;
  chatId: string;
  sessionId: string | null;
  role: 'user' | 'ai' | 'system';
  text: string;
  sequence: number;
  requestId?: string | null;
  originSurface?: 'dashboard' | 'extension' | 'legacy' | null;
  createdAt: string;
}

export interface SharedChatContext {
  userId: string;
  chats: DashboardChatSummary[];
  sessions: DashboardSessionSummary[];
  activeChatId: string | null;
}

export interface CaptureVisibleTabResult {
  dataUrl: string;
  mimeType: string;
  pageTitle: string;
  pageUrl: string;
}

export interface ExtensionAuthSession {
  access_token: string;
  refresh_token?: string;
  user_id?: string;
  email?: string | null;
  expires_at?: number;
}

export interface ExtensionAuthState {
  connected: boolean;
  userId?: string;
  email?: string | null;
  error?: string;
}

export interface CoachingRequest {
  chatId?: string;
  requestId: string;
  action: StudyAction;
  question?: string;
  userMessage: string;
  page: PageContext;
  context: ContextShareSettings;
  originSurface: 'extension';
  clientContext: CoachingClientContext;
  images?: CoachingImage[];
  screenshotDataUrl?: string;
}

export interface CoachingResponse {
  title: string;
  text: string;
  commit: CoachingCommit;
  screenshotDataUrl?: string;
}

export interface CoachingClientContext {
  page: {
    title: string;
    url?: string;
  };
  action: StudyAction;
  selection?: string;
  integrity: string;
}

export interface CoachingCommit {
  chatId: string;
  requestId: string;
  userMessageId: string;
  assistantMessageId: string;
  userSequence: number;
  assistantSequence: number;
}

export interface CoachingImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
}

export interface StudyTranscriptTurn {
  id: string;
  role: 'user' | 'ai' | 'system';
  text: string;
  atSeconds: number;
  sequence: number;
  createdAt?: string;
}

export type LiveUiState = 'idle' | 'starting' | 'connecting' | 'live' | 'paused' | 'stopping' | 'error';

export type LiveTokenStatus = 'ready' | 'fallback' | 'error';

export type LiveTokenResult =
  | {
      status: 'ready';
      webSocketUrl: string;
      tokenExpiresAt?: string;
      message: string;
    }
  | { status: 'fallback' | 'proxy_required' | 'stub'; message: string; expiresAt?: string };

export interface LiveSessionStatus {
  state: LiveUiState;
  /** Monotonic service-worker control operation; older status messages are stale. */
  operationId?: number;
  selectionFrozen: boolean;
  error?: string | null;
  warning?: string | null;
  fallback?: 'text-coaching' | null;
  rubric?: {
    id: string;
    title: string;
    fileSearchStatus?: string | null;
    criteriaCount?: number;
  } | null;
  ragReady?: boolean;
  chatId?: string | null;
}
