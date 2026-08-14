# Study Pilot Extension

Study Pilot is a Chrome Manifest V3 extension for a voice-first study companion, including **Gemini Live** coaching. Everything lives in a single on-page panel: the glowing listening orb, voice controls, quick study actions, the latest explanation, and session settings. There is no separate popup UI.

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

1. Resolve selected shared chat → capture tab JPEG → `POST live-token`
2. Service worker hands the Vertex OAuth `accessToken` + `websocketUrl` **only** to an offscreen document (never the content panel)
3. Offscreen connects to Vertex `BidiGenerateContent` (`apiVersion` from live-token, typically `v1beta1`) with `?access_token=` (browsers cannot set WS Authorization headers) and `historyConfig.initialHistoryInClientContent: true`
4. Seeds chat via `clientContent` using `initialTurns` from `live-token` (not a stub `[]`)
5. Sends one video screenshot, then streams mic PCM
6. Finalized turns commit via `live-turn` only when **both** user and assistant transcripts exist; stop calls `live-finish`
7. Chat/rubric selection is frozen while Live is active; a second Live start is rejected
8. If Live provisioning fails, the panel falls back to text coaching
9. On Gemini `GoAway` (or unexpected close), reconnect with the stored session resumption handle — do **not** reseed history/screenshot
10. Audio interrupt clears the PCM queue **and** stops already-scheduled Web Audio buffer sources

Automatic session save creates a same-ID session for an unlinked chat, preserves
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

- `activeTab`: allows the panel to capture the visible tab after explicit user action or when screenshot sharing is enabled for a coaching request.
- `storage`: stores only the user's Supabase access token for the extension session.
- `https://*.supabase.co/*`: lets the background worker call Supabase Data API and Edge Functions with the user's access token.
- `https://*.aiplatform.googleapis.com/*` and `wss://*.aiplatform.googleapis.com/*` (plus `us-` / `eu-aiplatform` hosts): Vertex Live WebSocket from `live-token.websocketUrl`. Generativelanguage hosts remain for the legacy Gemini ephemeral fallback.
- Content script matches `http://*/*` and `https://*/*` so the panel can appear on normal study pages. The extension does not request broad `<all_urls>` host permissions.
- `web_accessible_resources` exposes only the bundled font files so the panel can render its typeface from inside the shadow root.

The extension does not include server-side API keys, analytics, remote executable scripts, or silent data collection.

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
