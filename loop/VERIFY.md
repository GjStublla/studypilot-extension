# Verify Transcript - extension-ai-v1

Final verify run:

```powershell
npm run build
```

Result: PASS at `2026-07-07T22:32:37+02:00`.

Acceptance scans:

```powershell
rg "GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY" src manifest.json package.json
```

Result: PASS, no matches.

```powershell
rg "edgeFetch\('(live-token|socratic-coach|summarize-session)'|session_messages|duration_seconds|STUDYPILOT_SAVE_SESSION" src
```

Result: PASS, expected integration points present.

```powershell
rg "MOCK_ANSWER|createMockStudySession|saveStudySession" src
```

Result: PASS, no matches.

```powershell
Select-String -LiteralPath package-lock.json -Pattern '"@supabase/supabase-js"' -Context 0,1
```

Result: PASS, root package-lock dependency is pinned to `2.110.1`.

```powershell
rg "Connect StudyPilot|not connected|STUDYPILOT_GET_AUTH_STATUS|VITE_SUPABASE_URL|live-token|socratic-coach|auth" src README.md
```

Result: PASS, expected auth/docs markers present.
