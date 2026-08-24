import http from 'node:http';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const RUBRIC_ID = '22222222-2222-4222-8222-222222222222';
const chat = {
  id: CHAT_ID,
  session_id: null,
  title: 'Biology rubric chat',
  created_at: '2026-08-24T10:00:00.000Z',
  updated_at: '2026-08-24T10:00:00.000Z',
  rubric_id: RUBRIC_ID,
};
let messages = [];
const pendingLiveTokenResponses = new Set();
let liveTokenReleased = false;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>StudyPilot E2E fixture</title>
  </head>
  <body>
    <h1>Photosynthesis lecture notes</h1>
    <p>A local page used to load the unpacked StudyPilot content script.</p>
  </body>
</html>`;

function writeJson(response, payload, status = 200) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function writeSse(response, body) {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:4177');

  if (url.pathname === '/e2e/reset-live-token' && request.method === 'POST') {
    liveTokenReleased = false;
    writeJson(response, { ok: true });
    return;
  }

  if (url.pathname === '/e2e/live-token-status' && request.method === 'GET') {
    writeJson(response, {
      pending: pendingLiveTokenResponses.size,
      released: liveTokenReleased,
    });
    return;
  }

  if (url.pathname === '/e2e/release-live-token' && request.method === 'POST') {
    liveTokenReleased = true;
    const pending = [...pendingLiveTokenResponses];
    pendingLiveTokenResponses.clear();
    for (const pendingResponse of pending) {
      writeJson(
        pendingResponse,
        { error: 'e2e delayed live-token released' },
        503,
      );
    }
    writeJson(response, { ok: true, released: pending.length });
    return;
  }

  if (url.pathname.startsWith('/rest/v1/')) {
    if (url.pathname === '/rest/v1/dashboard_chats' && request.method === 'GET') {
      writeJson(response, [chat]);
      return;
    }
    if (url.pathname === '/rest/v1/rubrics' && request.method === 'GET') {
      writeJson(response, [{ id: RUBRIC_ID, title: 'Photosynthesis Rubric', file_search_status: 'indexed' }]);
      return;
    }
    if (url.pathname === '/rest/v1/sessions' && request.method === 'GET') {
      writeJson(response, []);
      return;
    }
    if (url.pathname === '/rest/v1/dashboard_chat_messages' && request.method === 'GET') {
      writeJson(response, messages);
      return;
    }
    writeJson(response, { error: 'StudyPilot E2E fixture endpoint not implemented.' }, 404);
    return;
  }

  if (url.pathname === '/functions/v1/socratic-coach' && request.method === 'POST') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body || '{}');
      const requestId = payload.requestId ?? 'e2e-request';
      const userMessage = payload.userMessage ?? 'Explain this page.';
      messages = [
        {
          id: '33333333-3333-4333-8333-333333333333',
          chat_id: CHAT_ID,
          session_id: null,
          role: 'user',
          text: userMessage,
          server_sequence: 1,
          request_id: requestId,
          origin_surface: 'extension',
          created_at: '2026-08-24T10:00:01.000Z',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          chat_id: CHAT_ID,
          session_id: null,
          role: 'ai',
          text: 'Grounded response: compare the claim with the rubric evidence before revising.',
          server_sequence: 2,
          request_id: requestId,
          origin_surface: 'extension',
          created_at: '2026-08-24T10:00:02.000Z',
        },
      ];
      const commit = {
        type: 'commit',
        chatId: payload.chatId ?? CHAT_ID,
        requestId,
        userMessageId: '33333333-3333-4333-8333-333333333333',
        assistantMessageId: '44444444-4444-4444-8444-444444444444',
        userSequence: 1,
        assistantSequence: 2,
      };
      writeSse(response, [
        `data: ${JSON.stringify({ text: 'Grounded response: ' })}`,
        '',
        `data: ${JSON.stringify({ text: 'compare the claim with the rubric evidence before revising.' })}`,
        '',
        `data: ${JSON.stringify(commit)}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n'));
    });
    return;
  }

  if (url.pathname === '/functions/v1/live-token' && request.method === 'POST') {
    request.resume();
    if (!liveTokenReleased) {
      pendingLiveTokenResponses.add(response);
      return;
    }
    writeJson(response, { error: 'e2e live-token unavailable' }, 503);
    return;
  }

  if (url.pathname === '/functions/v1/live-finish' && request.method === 'POST') {
    request.resume();
    writeJson(response, { ok: true });
    return;
  }

  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(html);
});

server.listen(4177, '127.0.0.1', () => {
  process.stdout.write('e2e fixture listening on http://127.0.0.1:4177/\n');
});
