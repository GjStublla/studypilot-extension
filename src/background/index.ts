/// <reference types="chrome" />

import { DASHBOARD_URL } from '@/shared/config';
import { isStudyPilotRuntimeMessage, parseLiveStartPayload } from '@/shared/extensionMessages';
import {
  clearExtensionSession,
  createDashboardChat,
  getDashboardChatMessages,
  getAuthStatus,
  getOrCreateSessionChat,
  getSharedChatContext,
  requestCoaching,
  requestLiveToken,
  setActiveDashboardChat,
  storeExtensionSession,
  syncStudySessionToSupabase,
} from '@/shared/studypilotSupabase';
import type { CaptureVisibleTabResult, CoachingRequest, LiveSessionStatus, PageContext } from '@/shared/types';
import {
  getLiveStatusMessage,
  handleOffscreenLiveMessage,
  pauseLive,
  restoreLivePersisted,
  resumeLive,
  startLive,
  stopLive,
} from './liveRuntime';
import type { OffscreenToSwMessage } from '@/live/messages';
import { isOffscreenMessage } from '@/live/messages';

const CAPTURE_MAX_EDGE = 1024;
const CAPTURE_JPEG_QUALITY = 0.72;

/** Resolve a message handler promise into a sendResponse call. */
function respond<T>(promise: Promise<T>, sendResponse: (r: unknown) => void): void {
  promise
    .then((data: T) => sendResponse({ ok: true, data }))
    .catch((error: unknown) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
}

chrome.runtime.onInstalled.addListener(() => {
  console.info('[StudyPilot] Installed. Click the toolbar icon to toggle the panel on any http/https page.');
  void restoreLivePersisted();
  chrome.action.setTitle({ title: 'Toggle Study Pilot' }).catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  void restoreLivePersisted();
});
void restoreLivePersisted();

// The toolbar icon is the single entry point: it toggles the on-page panel.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  const tabId = tab.id;

  chrome.tabs.sendMessage(tabId, { type: 'STUDYPILOT_TOGGLE_MODAL' }).catch(() => flashRefreshHint(tabId));
});

async function flashRefreshHint(tabId: number): Promise<void> {
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

function toLiveSessionStatus(): LiveSessionStatus {
  const status = getLiveStatusMessage();
  if (status.type !== 'STUDYPILOT_LIVE_STATUS') {
    return {
      state: 'idle',
      selectionFrozen: false,
    };
  }
  return {
    state: status.state,
    operationId: status.operationId,
    selectionFrozen: status.selectionFrozen,
    error: status.error,
    warning: status.warning,
    fallback: status.fallback,
    rubric: status.rubric,
    ragReady: status.ragReady,
    chatId: status.selection.chatId,
  };
}

chrome.runtime.onMessage.addListener((message: unknown, sender: chrome.runtime.MessageSender, sendResponse) => {
  if (message && typeof message === 'object' && 'type' in message) {
    const type = String((message as { type: string }).type);
    if (isOffscreenMessage(type) || type.startsWith('OFFSCREEN_')) {
      void handleOffscreenLiveMessage(message as OffscreenToSwMessage)
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;
    }
  }

  if (!isStudyPilotRuntimeMessage(message)) return false;

  switch (message.type) {
    case 'STUDYPILOT_GET_PAGE_CONTEXT':
      sendResponse({
        ok: true,
        data: getPageContextFromSender(sender),
      });
      return false;

    case 'STUDYPILOT_GET_AUTH_STATUS':
      respond(getAuthStatus(), sendResponse);
      return true;

    case 'STUDYPILOT_CONNECT_SESSION':
      respond(storeExtensionSession(message.payload), sendResponse);
      return true;

    case 'STUDYPILOT_DISCONNECT_SESSION':
      respond(clearExtensionSession(), sendResponse);
      return true;

    case 'STUDYPILOT_CAPTURE_VISIBLE_TAB':
      respond(captureVisibleTab(sender), sendResponse);
      return true;

    case 'STUDYPILOT_GET_SHARED_CONTEXT':
      respond(getSharedChatContext(), sendResponse);
      return true;

    case 'STUDYPILOT_GET_CHAT_MESSAGES':
      respond(getDashboardChatMessages(message.payload.chatId), sendResponse);
      return true;

    case 'STUDYPILOT_CREATE_CHAT':
      respond(createDashboardChat(message.payload.title, message.payload.sessionId ?? null), sendResponse);
      return true;

    case 'STUDYPILOT_CONTINUE_SESSION':
      respond(getOrCreateSessionChat(message.payload.sessionId, message.payload.title), sendResponse);
      return true;

    case 'STUDYPILOT_SELECT_CHAT':
      respond(
        setActiveDashboardChat(message.payload.chatId).then(() => ({ selected: true as const })),
        sendResponse,
      );
      return true;

    case 'STUDYPILOT_REQUEST_COACHING':
      respond(
        prepareCoachingRequest(message.payload, sender).then(async (request) => ({
          ...(await requestCoaching(request)),
          screenshotDataUrl: request.screenshotDataUrl,
        })),
        sendResponse,
      );
      return true;

    case 'STUDYPILOT_LIVE_START': {
      let parsed: ReturnType<typeof parseLiveStartPayload>;
      try {
        parsed = parseLiveStartPayload(message.payload);
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      const page = getPageContextFromSender(sender);
      startLive({
        chatId: parsed.chatId,
        privacy: parsed.privacy,
        windowId: sender.tab?.windowId,
        page: { title: page.sourceTitle, url: page.sourceUrl },
      })
        .then(() => sendResponse({ ok: true, data: toLiveSessionStatus() }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            data: toLiveSessionStatus(),
          }),
        );
      return true;
    }

    case 'STUDYPILOT_LIVE_STOP':
      stopLive('user_stop')
        .then(() => sendResponse({ ok: true, data: toLiveSessionStatus() }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            data: toLiveSessionStatus(),
          }),
        );
      return true;

    case 'STUDYPILOT_LIVE_PAUSE':
      pauseLive()
        .then(() => sendResponse({ ok: true, data: toLiveSessionStatus() }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;

    case 'STUDYPILOT_GET_LIVE_TOKEN':
      respond(requestLiveToken(message.payload?.sessionId), sendResponse);
      return true;

    case 'STUDYPILOT_LIVE_RESUME':
      resumeLive()
        .then(() => sendResponse({ ok: true, data: toLiveSessionStatus() }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;

    case 'STUDYPILOT_GET_LIVE_STATUS':
      sendResponse({ ok: true, data: toLiveSessionStatus() });
      return false;

    case 'STUDYPILOT_SAVE_SESSION':
      respond(
        syncStudySessionToSupabase(message.payload.chatId, message.payload.session, message.payload.finalize ?? false),
        sendResponse,
      );
      return true;

    case 'STUDYPILOT_OPEN_DASHBOARD':
      respond(
        chrome.tabs.create({ url: message.payload?.url ?? DASHBOARD_URL }).then(() => ({ opened: true as const })),
        sendResponse,
      );
      return true;

    case 'STUDYPILOT_OPEN_MODAL':
    case 'STUDYPILOT_TOGGLE_MODAL':
      return false;

    default:
      return false;
  }
});

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

async function captureVisibleTab(sender: chrome.runtime.MessageSender): Promise<CaptureVisibleTabResult> {
  if (sender.tab?.windowId === undefined) {
    throw new Error('Open StudyPilot on a page before capturing a screenshot.');
  }

  const pngDataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
    format: 'png',
  });
  const dataUrl = await compressCaptureDataUrl(pngDataUrl);
  const mimeType = dataUrlMimeType(dataUrl);

  return {
    dataUrl,
    mimeType,
    pageTitle: sender.tab.title ?? '',
    pageUrl: sender.tab.url ?? '',
  };
}

async function prepareCoachingRequest(
  request: CoachingRequest,
  sender: chrome.runtime.MessageSender,
): Promise<CoachingRequest> {
  // If images were already attached by the content script, skip captureVisibleTab
  // entirely — calling it without a fresh activeTab gesture throws a permission error.
  if ((request.images ?? []).length > 0) return request;

  // context.screenshot is only set true when no images were pre-attached and
  // the user has the global "screenshot on" toggle enabled.
  if (!request.context.screenshot) return request;

  const capture = await captureVisibleTab(sender);
  const image = dataUrlToImage(capture.dataUrl, capture.mimeType);

  return {
    ...request,
    page: {
      ...request.page,
      sourceTitle: capture.pageTitle || request.page.sourceTitle,
      sourceUrl: capture.pageUrl || request.page.sourceUrl,
    },
    images: [...(request.images ?? []), image],
    screenshotDataUrl: capture.dataUrl,
  };
}

async function compressCaptureDataUrl(dataUrl: string): Promise<string> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Screenshot compression is unavailable in this browser context.');
  }

  const sourceBlob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();
    throw new Error('Screenshot compression could not create a drawing context.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const jpeg = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: CAPTURE_JPEG_QUALITY,
  });

  return `data:image/jpeg;base64,${arrayBufferToBase64(await jpeg.arrayBuffer())}`;
}

function dataUrlToImage(dataUrl: string, mimeType: string) {
  const [, data = ''] = dataUrl.split(',');
  const actualMimeType = dataUrlMimeType(dataUrl);
  if (mimeType !== actualMimeType) {
    throw new Error('Screenshot capture MIME type did not match the image payload.');
  }

  return {
    mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
    data,
  };
}

function dataUrlMimeType(dataUrl: string): string {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,/i.exec(dataUrl);
  if (!match) throw new Error('Screenshot capture returned an unsupported image format.');
  return match[1].toLowerCase();
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
