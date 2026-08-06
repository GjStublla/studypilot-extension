export const STUDY_FOLDERS = [
  'Biology 101',
  'History Midterm',
  'Programming Assignment',
] as const;

export type StudyFolder = (typeof STUDY_FOLDERS)[number];

export type StudyPhase = 'idle' | 'thinking' | 'answer' | 'saved';

export type StudyAction = 'explain' | 'summarize' | 'quiz' | 'flashcards';

export type StudyPilotSessionMode =
  | 'Essay Coach'
  | 'Presentation Coach'
  | 'Study Coach'
  | 'Lecture'
  | 'Research Reader';

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
  chatId: string;
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

export type LiveTokenStatus = 'stub' | 'ready' | 'fallback' | 'proxy_required';

export interface LiveTokenResult {
  status: LiveTokenStatus;
  expiresAt?: string;
  webSocketUrl?: string;
  tokenExpiresAt?: string;
  message: string;
}
