export const STUDY_FOLDERS = [
  'Biology 101',
  'History Midterm',
  'Programming Assignment',
  '+ New study folder',
] as const;

export type StudyFolder = (typeof STUDY_FOLDERS)[number];

export type StudyPilotStatus =
  | 'ready'
  | 'screenshot-ready'
  | 'live-sharing'
  | 'explaining'
  | 'saved';

export type StudyPilotView =
  | 'idle'
  | 'screenshot'
  | 'live'
  | 'thinking'
  | 'answer'
  | 'saved';

export type StudyAction =
  | 'explain'
  | 'summarize'
  | 'quiz'
  | 'flashcards'
  | 'step-by-step';

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
  question: string;
  answer: string;
  folder: StudyFolder;
  createdAt: string;
  tags: string[];
}

export interface DashboardSaveResult {
  ok: true;
  session: StudySession;
  dashboardUrl: string;
}

export interface CaptureVisibleTabResult {
  dataUrl: string;
  pageTitle: string;
  pageUrl: string;
}

export interface GeminiQueryResult {
  answer: string;
}