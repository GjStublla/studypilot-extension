# Study Pilot Extension

Study Pilot is a Chrome Manifest V3 extension MVP for a voice-first study companion. Everything lives in a single on-page panel: the glowing listening orb, voice controls, quick study actions, the latest explanation, and session settings. There is no separate popup UI.

## AI Integration

The main question box and the Summarize, Explain, Quiz Me, and Flashcards
actions call StudyPilot's Supabase Edge Functions from the background worker.
The extension sends text, recent transcript history, page context, and an
optional compressed screenshot to `functions/v1/socratic-coach`.

Session save inserts `sessions` and `session_messages`, uploads the latest
screenshot to the private `session-captures` bucket, and then calls
`functions/v1/summarize-session` so the dashboard can import the transcript,
summary, screenshot, and action items.

Google service-account JSON, Gemini keys, and Supabase service-role keys must
stay on the server side. Never copy them into this repository or into a `VITE_`
environment variable, because Vite embeds those values in the public extension
bundle.

## Run Locally

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
4. Select the generated `dist` folder after `npm run build`.
5. Open any normal `http` or `https` page and click the Study Pilot toolbar icon to toggle the panel. A small launcher orb also sits in the bottom-right corner of the page.

## One Surface

- The toolbar icon toggles the on-page panel (no popup window).
- The ⋮ menu in the panel holds snapshot capture, save to dashboard, dashboard link, and minimize.
- The gear button opens session settings (context sharing toggles, study folder, dashboard link).

## Permissions

- `activeTab`: allows the panel to capture the visible tab after explicit user action or when screenshot sharing is enabled for a coaching request.
- `storage`: stores only the user's Supabase access token for the extension session.
- `https://*.supabase.co/*`: lets the background worker call Supabase Data API and Edge Functions with the user's access token.
- Content script matches `http://*/*` and `https://*/*` so the panel can appear on normal study pages. The extension does not request broad `host_permissions`.
- `web_accessible_resources` exposes only the bundled font files so the panel can render its typeface from inside the shadow root.

The extension does not include server-side API keys, analytics, remote executable scripts, or silent data collection.

## Supabase AI Integration

Real:

- Text coaching calls `functions/v1/socratic-coach` from the background worker and returns the streamed response to the card.
- Screenshot sharing compresses the visible tab to JPEG, sends it to the coaching function as an image part, and displays the sent screenshot in the answer card.
- Auto-save uses the same Supabase save path as the menu Save action when the Auto-save setting is enabled.
- Session save inserts `sessions` and `session_messages`, then calls `functions/v1/summarize-session` so the dashboard can import the session and action items.
- Live access requests call `functions/v1/live-token`. The extension handles both the current stub response and the future real Gemini Live token response shape.
- The extension never stores or refreshes the dashboard refresh token. When the panel runs on the StudyPilot dashboard (or localhost dashboard dev), it bridges only the access token from `sp_access_token` or Supabase's OAuth storage into `chrome.storage.local`. When that access token expires, AI and save actions ask the user to reconnect by opening the dashboard.

Already local/runtime:

- MV3 manifest, content script injection, and background message routing.
- Toolbar-icon toggle of the panel, launcher orb, and all panel state transitions.
- Read-aloud (Web Speech API) and copy-to-clipboard on the answer card.
- Dashboard open handoff to `https://app.studypilot.ai/sessions`.
- Snapshot capture permission plumbing and local answer-card screenshot preview.

Pending backend/live work:

- Full microphone and screen-frame streaming to Gemini Live. The backend `live-token` Edge Function currently returns a stub token, so the extension reports that state instead of starting a fake live session.

The expected architecture is: extension asks Supabase for a short-lived Live token, then connects directly to Gemini Live. The extension must never proxy Gemini audio or screen frames through Supabase and must never expose Gemini/server Supabase secrets.
