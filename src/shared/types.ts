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

export interface CaptureVisibleTabResult {
  dataUrl: string;
  mimeType: string;
  pageTitle: string;
  pageUrl: string;
}

export interface ExtensionAuthSession {
  access_token: string;
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
  action: StudyAction;
  question?: string;
  page: PageContext;
  context: ContextShareSettings;
  sessionId?: string;
  history?: CoachingHistoryTurn[];
  images?: CoachingImage[];
  screenshotDataUrl?: string;
}

export interface CoachingResponse {
  title: string;
  text: string;
  screenshotDataUrl?: string;
}

export interface CoachingHistoryTurn {
  role: 'user' | 'ai' | 'system';
  text: string;
}

export interface CoachingImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
}

export interface StudyTranscriptTurn {
  role: 'user' | 'ai' | 'system';
  text: string;
  atSeconds: number;
}

export type LiveTokenStatus = 'stub' | 'ready' | 'fallback' | 'proxy_required';

export interface LiveTokenResult {
  status: LiveTokenStatus;
  expiresAt?: string;
  webSocketUrl?: string;
  tokenExpiresAt?: string;
  accessToken?: string;
  model?: string;
  message: string;
}
