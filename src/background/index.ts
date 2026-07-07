/// <reference types="chrome" />

import { DASHBOARD_URL, saveStudySession } from '@/shared/mockDashboard';
import {
  isStudyPilotRuntimeMessage,
  type StudyPilotRuntimeMessage,
} from '@/shared/extensionMessages';
import type {
  CaptureVisibleTabResult,
  GenerateStudyAnswerRequest,
  GenerateStudyAnswerResult,
  PageContext,
} from '@/shared/types';

const AI_API_URL =
  import.meta.env.VITE_AI_API_URL || 'http://localhost:8000/ai/generate';

chrome.runtime.onInstalled.addListener(() => {
  console.info('[StudyPilot] Installed. Click the toolbar icon to toggle the panel on any http/https page.');
});

// The toolbar icon is the single entry point: it toggles the on-page panel.
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  const tabId = tab.id;

  chrome.tabs
    .sendMessage(tabId, { type: 'STUDYPILOT_TOGGLE_MODAL' })
    .catch(() => flashRefreshHint(tabId));
});

async function flashRefreshHint(tabId: number): Promise<void> {
  // Content script is not on this page (chrome:// page, web store, or a tab
  // opened before the extension was installed). Hint that a refresh is needed.
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#5b4df0' });
    await chrome.action.setBadgeText({ tabId, text: '↻' });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
    }, 2600);
  } catch {
    // Tab may have closed; nothing to do.
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: StudyPilotRuntimeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse,
  ) => {
    if (!isStudyPilotRuntimeMessage(message)) return false;

    switch (message.type) {
      case 'STUDYPILOT_GET_PAGE_CONTEXT':
        sendResponse({
          ok: true,
          data: getPageContextFromSender(sender),
        });
        return false;

      case 'STUDYPILOT_CAPTURE_VISIBLE_TAB':
        captureVisibleTab(sender)
          .then(data => sendResponse({ ok: true, data }))
          .catch(error =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;

      case 'STUDYPILOT_GENERATE_ANSWER':
        generateStudyAnswer(message.payload)
          .then(data => sendResponse({ ok: true, data }))
          .catch(error =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;

      case 'STUDYPILOT_SAVE_SESSION':
        saveStudySession(message.payload.session)
          .then(data => sendResponse({ ok: true, data }))
          .catch(error =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;

      case 'STUDYPILOT_OPEN_DASHBOARD':
        chrome.tabs
          .create({ url: message.payload?.url ?? DASHBOARD_URL })
          .then(() => sendResponse({ ok: true, data: { opened: true } }))
          .catch(error =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;

      case 'STUDYPILOT_OPEN_MODAL':
      case 'STUDYPILOT_TOGGLE_MODAL':
        return false;

      default:
        return false;
    }
  },
);

async function generateStudyAnswer(
  request: GenerateStudyAnswerRequest,
): Promise<GenerateStudyAnswerResult> {
  const response = await fetch(AI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail || `AI request failed (${response.status}).`);
  }

  const data = (await response.json()) as Partial<GenerateStudyAnswerResult>;
  if (typeof data.body !== 'string' || !data.body.trim()) {
    throw new Error('The AI endpoint returned an invalid response.');
  }

  return {
    title:
      typeof data.title === 'string' && data.title.trim()
        ? data.title.trim()
        : 'StudyPilot answer',
    body: data.body.trim(),
  };
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      detail?: unknown;
      error?: unknown;
    };
    if (typeof data.detail === 'string') return data.detail;
    if (typeof data.error === 'string') return data.error;
  } catch {
    // The endpoint may return an empty or non-JSON error response.
  }
  return '';
}

function getPageContextFromSender(sender: chrome.runtime.MessageSender): PageContext {
  const tab = sender.tab;
  const sourceUrl = tab?.url ?? '';
  const host = safeHost(sourceUrl);

  return {
    sourceUrl,
    sourceTitle: tab?.title || host || 'Current page',
    host,
  };
}

async function captureVisibleTab(
  sender: chrome.runtime.MessageSender,
): Promise<CaptureVisibleTabResult> {
  if (sender.tab?.windowId === undefined) {
    throw new Error('Open StudyPilot on a page before capturing a screenshot.');
  }

  // TODO: Wire this into the UI when moving beyond the simulated screenshot.
  // chrome.tabs.captureVisibleTab requires user activation and activeTab access.
  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
    format: 'png',
  });

  return {
    dataUrl,
    pageTitle: sender.tab.title ?? '',
    pageUrl: sender.tab.url ?? '',
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
