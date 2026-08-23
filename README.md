# Study Pilot Extension

StudyPilot is a rubric-aware coaching loop across the browser and dashboard: it uses the page, the student's question, and an uploaded rubric to coach the next improvement, then carries the conversation and action items into the dashboard.

This Manifest V3 extension is the on-page panel. It uses your microphone and the page context you choose to share. Answers can cite retrieved rubric or uploaded-document evidence when grounding is available. Sign in once to connect the extension and dashboard.

Live microphone audio is processed by Google Vertex AI while Live is active. Screenshots are sent only when you enable them. Chat and session history save only when “Save to dashboard” is on. There is no separate popup UI.

> **This repository (`studypilot-extension`) is the canonical Chrome extension.**  
> The sibling `studypilot/extension` folder is a Live scaffold/mirror only — do not treat it as the shipping source of truth.

## AI Integration

The main question box and the Summarize, Explain, Quiz Me, and Flashcards
actions call StudyPilot's Supabase Edge Functions from the background worker.
The extension sends the plain student message, the selected shared chat id,
page context, and an optional compressed screenshot to
`functions/v1/socratic-coach`. Canonical history is loaded by the function
from `dashboard_chat_messages`, so the dashboard and extension continue the
same conversation without duplicating client-side history.

**Live coaching** (mic button):

1. Resolve selected shared chat → optional tab JPEG when screenshot sharing is on → `POST live-token`
2. Service worker hands the Vertex OAuth `accessToken` + `websocketUrl` **only** to an offscreen document (never the content panel)
3. Offscreen connects to Vertex `BidiGenerateContent` (`apiVersion` from live-token, typically `v1beta1`) with `?access_token=` (browsers cannot set WS Authorization headers) and `historyConfig.initialHistoryInClientContent: true`
4. Seeds chat via `clientContent` using `initialTurns` from `live-token` (not a stub `[]`)
5. Sends one video screenshot, then streams mic PCM
6. Finalized turns commit via `live-turn` only when **both** user and assistant transcripts exist; stop calls `live-finish`
7. Chat/rubric selection is frozen while Live is active; a second Live start is rejected
8. If Live provisioning fails, the panel falls back to text coaching
9. On Gemini `GoAway` (or unexpected close), reconnect with the stored session resumption handle — do **not** reseed history/screenshot
10. Audio interrupt clears the PCM queue **and** stops already-scheduled Web Audio buffer sources

When **Save to dashboard** is enabled, session save creates a same-ID session for an unlinked chat, preserves
the provenance and duration of an existing linked session, inserts canonical
message ids into `session_messages` idempotently, and upserts the latest
screenshot in the private `session-captures` bucket. The explicit Save action
finalizes the session through `functions/v1/summarize-session`.

Google service-account JSON, Gemini keys, and Supabase service-role keys must
stay on the server side. Never copy them into this repository or into a `VITE_`
environment variable, because Vite embeds those values in the public extension
bundle.

## Run Locally

### Full local StudyPilot stack

Use this mode with the sibling `studypilot` repository's local Supabase stack.
It signs in or creates the shared `dev@studypilot.local` account automatically,
so the unpacked extension can call real local Edge Functions and save local data
without visiting a login screen.

1. Start Supabase, local Edge Functions, and `npm run dev:local` in the
   `studypilot` repository.
2. Build and load the isolated local package. The repository tracks the
   standard public Supabase CLI URL and anon key in `.env.studypilot-local`, so
   no extension secret setup is required:

```bash
npm install
npm run build:local
```

Load `dist-local` from `chrome://extensions`. Chrome labels it
**Study Pilot (Local)** and grants localhost access only in that build. The
local extension reauthenticates automatically when its access token expires.
AI usage is bypassed by the local Edge Function runtime; the extension itself
does not weaken authentication or quota handling.

The normal `npm run build` command still writes `dist`, targets the configured
hosted project, requires a dashboard session, and has no localhost host
permissions. It fails fast if either configured production URL points at
localhost, preventing a local package from being mistaken for a release build.

### UI preview and production build

```bash
npm install
npm run build
```

Create a local env file before building real integrations:

```bash
cp .env.example .env.local
```

Required public values:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_DASHBOARD_URL=https://app.studypilot.ai/sessions
```

Do not put Gemini API keys or Supabase service-role keys in this extension. Gemini and service-role calls belong in Supabase Edge Functions.

For iterative work:

```bash
npm run dev
```

A standalone UI preview (no extension runtime needed) is served at `http://127.0.0.1:5179/src/dev/preview.html` while `npm run dev` is running.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `dist` after `npm run build`, or `dist-local` after
   `npm run build:local`.
5. Open any normal `http` or `https` page and click the Study Pilot toolbar icon to toggle the panel. A small launcher orb also sits in the bottom-right corner of the page.

## One Surface

- The toolbar icon toggles the on-page panel (no popup window).
- The ⋮ menu in the panel holds snapshot capture, save to dashboard, dashboard link, and minimize.
- The gear button opens session settings (context sharing toggles, study folder, dashboard link).

## Permissions

Named MV3 permissions:

- `offscreen`: required so Live can call `getUserMedia` from an offscreen document. Chrome does not support a named `microphone` permission; this package does not request one.
- `storage`: extension settings, session bridge state, and Live resumption handles.
- `tabs`: query tabs so Live status can fan out, `captureVisibleTab` for optional screenshots, `tabs.create` for dashboard handoff, and `tabs.sendMessage` for the toolbar toggle.
- `activeTab`: `chrome.tabs.captureVisibleTab` after a user gesture on pages that are not covered by host permissions. The extension does not use `chrome.scripting` and does not request `scripting`.

Host permissions stay limited to the APIs the background worker actually calls: Supabase (`https://*.supabase.co/*`), StudyPilot (`https://studypilot.app/*`, `https://*.studypilot.ai/*`), Gemini/Generative Language, and Vertex AI. `npm run build` never adds loopback hosts. Use `npm run build:local` when the dashboard and Supabase are on localhost.

Content scripts still match `http://*/*` and `https://*/*` so the panel can appear on normal study pages. **Chrome will warn that this extension can read and change data on all websites.** That warning is expected for this beta. The extension does not add a matching `<all_urls>` host permission.

`web_accessible_resources` exposes bundled fonts, `audio-worklet.js`, and the offscreen document. The package does not include server-side API keys, analytics, remote executable scripts, or silent data collection.

## Test and validate

Windows (PowerShell):

```powershell
npm install
npm run typecheck
npm test
npm run build
npm run validate:manifest
npx playwright install chromium
npx playwright test
```

`npx playwright test` is the same as `npm run test:e2e`. It loads unpacked `dist/` with `--disable-extensions-except` and `--load-extension`. If Chromium is missing, install only Chromium (`npx playwright install chromium`). Do not commit browser binaries.

Playwright cannot click the Chrome toolbar icon. The toolbar-equivalent spec sends the same `STUDYPILOT_TOGGLE_MODAL` message that `chrome.action.onClicked` sends, from `src/offscreen.html`, because `serviceWorker.evaluate` does not expose `chrome.tabs` in this Playwright version. That covers the content-script toggle path, not a real toolbar click. Microphone denial is asserted on the in-page voice fallback; Live offscreen `getUserMedia` still needs a user gesture in Chrome.

To watch the browser: `$env:PW_HEADED=1; npx playwright test`

CI (Linux or GitHub Actions):

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate:manifest
npx playwright install --with-deps chromium
npx playwright test
```

`npm run validate:manifest` fails if `dist/manifest.json` names a `microphone` permission, lists loopback host permissions, omits `offscreen`, or if runtime code has no `USER_MEDIA` offscreen reason.

Unpacked load in Chrome:

1. `npm run build`
2. Open `chrome://extensions`, enable Developer mode, Load unpacked, select `dist`.
3. Chrome should show no manifest error for `microphone`. The all-sites content-script warning remains. After a user gesture, Live still uses the offscreen document for microphone capture.

This repo does not automate `chrome://extensions` itself. Treat a Playwright pass as unpacked-load evidence; do not claim a separate manual Chrome UI pass unless a human recorded one.

## Supabase AI Integration

Real:

- Text coaching calls `functions/v1/socratic-coach` from the background worker and returns the streamed response to the card.
- Screenshot sharing compresses the visible tab to JPEG, sends it to the coaching function as an image part, and displays the sent screenshot in the answer card.
- The chat selector lists dashboard chats and sessions, remembers the active chat per user, and reloads canonical messages when the panel opens or regains focus.
- Auto-save updates the same linked session and does not spend another AI request on summarization.
- The menu Save action finalizes the current session and calls `functions/v1/summarize-session` so the dashboard can create its summary and action items.
- Live access uses `functions/v1/live-token` from the service worker. The ephemeral token is passed only to the offscreen Live document; the content panel never receives it.
- Finalized Live turns call `live-turn`; stop calls `live-finish`. Rubric tool calls use `live-rubric-search`.
- The chat picker shows rubric title / File Search readiness when a chat has a linked rubric.
- The extension never stores or refreshes the dashboard refresh token. When the panel runs on the StudyPilot dashboard (or localhost dashboard dev), it bridges only the access token as a credential from `sp_access_token` or Supabase's OAuth storage into `chrome.storage.local`; it also remembers the selected chat id per user. When that access token expires, AI and save actions ask the user to reconnect by opening the dashboard.

Already local/runtime:

- MV3 manifest, content script injection, offscreen Live document, and background message routing.
- Toolbar-icon toggle of the panel, launcher orb, and all panel state transitions.
- Read-aloud (Web Speech API) and copy-to-clipboard on the answer card.
- Dashboard open handoff to the selected `#dashboard?chat=<id>` conversation.
- Snapshot capture permission plumbing and local answer-card screenshot preview.
