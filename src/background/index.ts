/// <reference types="chrome" />

import { DASHBOARD_URL, saveStudySession } from '@/shared/mockDashboard';
import {
  isStudyPilotRuntimeMessage,
  type StudyPilotRuntimeMessage,
} from '@/shared/extensionMessages';
import type { CaptureVisibleTabResult, PageContext } from '@/shared/types';

chrome.runtime.onInstalled.addListener(() => {
  console.info('[StudyPilot] MVP installed. Floating UI is injected on http/https pages.');
});

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
        return false;

      default:
        return false;
    }
  },
);

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
