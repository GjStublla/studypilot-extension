# Study Pilot Extension

Study Pilot is a Chrome Manifest V3 extension MVP for a voice-first study companion. Everything lives in a single on-page panel: the glowing listening orb, voice controls, quick study actions, the latest explanation, and session settings. There is no separate popup UI.

## AI Answer Endpoint

The main question box and the Summarize, Explain, Quiz Me, and Flashcards
actions call the server configured by `VITE_AI_API_URL` (default:
`http://localhost:8000/ai/generate`).

The extension sends:

```json
{
  "action": "explain",
  "question": "What does this mean?",
  "pageTitle": "Example page",
  "pageUrl": "https://example.com",
  "selectedText": "Optional text selected by the user"
}
```

The endpoint must return:

```json
{
  "title": "Short answer title",
  "body": "The generated study answer."
}
```

Google service-account JSON and private keys must stay on that server. Never
copy them into this repository or into a `VITE_` environment variable, because
Vite embeds those values in the public extension bundle.

## Run Locally

```bash
npm install
npm run build
```

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

- `activeTab`: reserved for a future real screenshot capture flow using `chrome.tabs.captureVisibleTab` after explicit user activation.
- Content script matches `http://*/*` and `https://*/*` so the panel can appear on normal study pages. The extension does not request broad `host_permissions`.
- `web_accessible_resources` exposes only the bundled font files so the panel can render its typeface from inside the shadow root.

The extension does not include API keys, analytics, remote executable scripts, or silent data collection.

## Mocked Vs Real

Mocked:

- Screenshot capture state.
- Microphone listening state and AI answer generation.
- Dashboard save service.

Real:

- MV3 manifest, content script injection, and background message routing.
- Toolbar-icon toggle of the panel, launcher orb, and all panel state transitions.
- Read-aloud (Web Speech API) and copy-to-clipboard on the answer card.
- Dashboard open handoff to `https://app.studypilot.ai/sessions`.

Integration TODOs are left near the relevant code for screenshot capture, the AI backend, and the dashboard API.
