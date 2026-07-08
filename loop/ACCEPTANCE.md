# Acceptance Inventory - extension-ai-v1

```yaml
- id: AC-001
  statement: Extension configuration uses only public Supabase/Vite values and never exposes server-side Gemini or service-role secrets.
  source: user request + context/supabase/supabase.md sections 3, 6, 26
  authority: StudyPilot Supabase architecture manual
  verifier: npm run build; rg "GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY" src manifest.json package.json
  pass_evidence: build exits 0; rg returns no matches in extension/browser code
  fail_evidence: secret env names appear in extension source or build fails
  status: PASS
  depends_on: []
  reopen_condition: extension env/auth configuration changes
  last_verification: "2026-07-07T22:32:37+02:00 - npm run build passed; secret-name rg returned no matches"

- id: AC-002
  statement: Background worker provides authenticated Supabase AI/session operations for auth status, live token, text coaching, and session import.
  source: user request + context/supabase/supabase.md sections 19, 21, 26
  authority: StudyPilot Supabase architecture manual
  verifier: npm run build; rg "edgeFetch\('(live-token|socratic-coach|summarize-session)'|session_messages|duration_seconds|STUDYPILOT_SAVE_SESSION" src
  pass_evidence: build exits 0; background/shared code contains the expected Edge Function and table integration points
  fail_evidence: only mockDashboard save path exists or Edge Function calls are missing
  status: PASS
  depends_on: []
  reopen_condition: Supabase Edge Function contract changes
  last_verification: "2026-07-07T22:32:37+02:00 - npm run build passed; live-token, socratic-coach, summarize-session, and session_messages integration points present"

- id: AC-003
  statement: Content panel asks the real StudyPilot coaching endpoint for explain, summarize, quiz, flashcard, and custom-question actions instead of returning hardcoded answer text as the normal success path.
  source: user request + current FloatingStudyPilot mock implementation
  authority: StudyPilot product flow
  verifier: npm run build; rg "STUDYPILOT_REQUEST_COACHING|mock answer unavailable|MOCK_ANSWER" src/content src/shared
  pass_evidence: build exits 0; panel dispatches a coaching runtime message; hardcoded answer is absent from normal success path
  fail_evidence: cardForAction returns a static educational answer without calling background AI
  status: PASS
  depends_on: [AC-002]
  reopen_condition: panel action model changes
  last_verification: "2026-07-07T22:32:37+02:00 - npm run build passed; content panel dispatches STUDYPILOT_REQUEST_COACHING; old mock answer/save helpers absent"

- id: AC-004
  statement: Saving a session writes a Supabase session row, transcript messages, and triggers session summarization/action-item generation.
  source: context/supabase/supabase.md section 19
  authority: StudyPilot Supabase architecture manual
  verifier: npm run build; rg "STUDYPILOT_SAVE_SESSION|summarize-session|session_messages|duration_seconds" src
  pass_evidence: build exits 0; save flow maps panel data to sessions/session_messages and calls summarize-session
  fail_evidence: save flow returns fake dashboard success without Supabase writes
  status: PASS
  depends_on: [AC-002]
  reopen_condition: session import schema changes
  last_verification: "2026-07-07T22:32:37+02:00 - npm run build passed; save flow uses STUDYPILOT_SAVE_SESSION, sessions fields, session_messages, and summarize-session"

- id: AC-005
  statement: Missing or expired extension auth fails cleanly and tells the user to connect/sign in instead of silently reporting AI or dashboard success.
  source: Supabase auth/session requirements
  authority: Supabase Auth docs + StudyPilot architecture manual
  verifier: npm run build; rg "Connect StudyPilot|Not connected|StudyPilot is not connected|STUDYPILOT_GET_AUTH_STATUS" src
  pass_evidence: build exits 0; user-facing missing-auth branch exists for coaching and saving
  fail_evidence: missing auth falls back to mock success
  status: PASS
  depends_on: [AC-002, AC-003, AC-004]
  reopen_condition: extension auth UX is redesigned
  last_verification: "2026-07-07T22:32:37+02:00 - npm run build passed; missing-auth copy and STUDYPILOT_GET_AUTH_STATUS path present"

- id: AC-006
  statement: README documents the real AI integration, required public env file, auth-token bridge expectation, and what remains stubbed by backend live-token.
  source: user request + env.download + context/supabase/supabase.md
  authority: repository documentation contract
  verifier: npm run build; rg "VITE_SUPABASE_URL|live-token|socratic-coach|auth" README.md
  pass_evidence: build exits 0; README names the required env and integration behavior
  fail_evidence: README still says AI answer generation and dashboard save are mocked without qualification
  status: PASS
  depends_on: []
  reopen_condition: integration or deployment setup changes
  last_verification: "2026-07-07T22:32:37+02:00 - npm run build passed; README documents public env, auth, live-token, and socratic-coach"
```
