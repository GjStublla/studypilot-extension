You are running a terminal goal loop on this repository.

Your job is not to explore the frontier.
Your job is to make a finite acceptance inventory pass without weakening it.

> **Loop provenance - composed by `/loopgen`.**
> Archetype: `goal`  *  Divergences: `none`.
> Overlays: `none`.
> Consult-capability: `tier-0` (`none - human-look gate substituted`).
> Evaluator tier: `n/a`.
> Frontload - resolved: [`context/supabase/supabase.md`, `studypilot-extension` repo, `env.download`, `ai_vertex_reference_bundle`, current extension build command]; defaulted: [`stuck-attempt N=3`, `all criteria independent`, `no programmatic consult`]; open gaps: [`real Supabase user session/token must be present in extension storage before live calls can be verified against production`].
> Primitive sources: `goal defaults from target-shape, halt-shape, artifact-shape, convergence-shape, cadence-shape`.
> Re-derive (do not hand-edit) when intent, sources, or environment change.

## Motive

Implement the StudyPilot extension AI integration so the content panel uses the Supabase-backed StudyPilot AI functions instead of mock-only responses, without exposing server-side secrets.

## Runner contract

This prompt is runner-agnostic internally. The canonical operator runner is
`/goal`, which re-invokes this prompt iteratively. The prompt assumes only:

1. Iterative re-invocation - you are one iteration.
2. File-persisted state - durable progress lives in named files, not memory.
3. A logical halt signal - emit `stop-and-summarize` when no useful
   iteration remains; the runner maps it.
4. A logical escalate signal - emit `escalate: <reason>` only when
   blocked on something genuinely irreversible or external (paid API
   without budget cap, public-publish, secrets, decisions that cannot
   be rolled back). Reversible judgment is not escalation - see the
   judgment default.

External ceilings (token limits, max-iterations, session length) are
runner concerns, not repository failure. Preserve the worktree and
summarize unresolved work for the next run.

## Judgment default

When the iteration hits a taste-based or inferred judgment call, prefer
the narrow reversible choice + log over pausing:

1. Pick the smallest reversible action consistent with the strongest
   available source.
2. Record an Alignment Review with: problem, context, options
   considered, chosen contract, alignment cost, rollback trigger, and
   review question for the human.
3. Continue. Human review happens after the fact.

Escalate (do not proceed) only when the action is irreversible,
externally blocked, or requires authority the loop cannot establish:

- paid APIs without budget caps,
- public-publish or messages-sent actions,
- secrets / credentials,
- product-direction changes whose rollback is unclear,
- source conflict between authoritative-current sources.

Never call `AskUserQuestion` or any interactive / blocking / approval-prompt
tool, for any reason. The runner may be unattended, so the call is a deadlock,
not a question. Route a reversible decision to the smallest default above + an
Alignment Review; route a needs-a-human or irreversible one to `escalate` /
`stop-and-summarize` with the question in the summary. Async, never interactive.

## Frontload

Resolved:

- Architecture source: `C:\Users\gjins\Desktop\studypilot\context\supabase\supabase.md`.
- Extension repo: `C:\Users\gjins\Desktop\studypilot-extension`.
- AI reference source: `C:\Users\gjins\Downloads\maturamentor_ai_skeleton_bundle\maturamentor_ai_skeleton\ai_vertex_reference_bundle`.
- Public extension env source: `C:\Users\gjins\Downloads\env.download`.
- Cheap inner channel and final verify: `npm run build`.

Defaulted:

- Criteria are independent.
- Stuck-attempt threshold is 3.
- No direct Gemini API or Supabase service-role key may be added to the extension.
- If no extension Supabase session is present, the UI must fail cleanly and route the user to the dashboard/login surface instead of returning fake AI success.

Open gaps:

- Production live-token behavior depends on the deployed Supabase Edge Function. If the function still returns a stub token, the extension must expose that honestly and remain compatible with the future real token response shape.

## Oracle principles

This loop is honest by construction:

1. Oracle is binary - pass/fail; never subjective, never self-assessment.
2. Oracle independence - a verifier authored during the loop must first fail against the unmet behavior when practical.
3. Consumer-side oracle - if the verifier passes, the extension user has the working behavior.
4. Anti-theater - `FIXED != CLOSED`. Criterion-specific proof is `PASS_PENDING_FINAL`; `PASS` requires the final verify to prove the whole inventory in one repo state.

## Terminal contract

The run is complete only when every criterion in `loop/ACCEPTANCE.md` for goal version `extension-ai-v1` reaches `PASS`.

Completion is a specific halt:

1. emit `criteria-met`
2. then emit `stop-and-summarize`
3. label the halt cause `criteria-met`

Do not emit `criteria-met` for partial completion, local green commands, manual confidence, or "all easy rows done."

## Goal version

`extension-ai-v1` - frozen inventory from the user request, Supabase architecture manual, current extension code, and the supplied AI Vertex reference bundle.

## Acceptance inventory

`loop/ACCEPTANCE.md` is the live anchor inventory. Statuses:

- `OPEN` - no criterion-specific proof yet.
- `PASS_PENDING_FINAL` - the criterion's own verifier passed, but the final verify has not proved the whole inventory together since.
- `PASS` - the final verify proved this criterion in the same repo state as every other criterion.
- `STUCK` - 3 consecutive failed hypotheses with no new evidence.
- `BLOCKED_EXTERNAL` - genuine irreversible / external blocker.
- `QUARANTINED` - provenance, criteria, or verifier integrity conflict.

Only `PASS` counts for terminal completion. Every accepted change cites at least one criterion ID.

## Channels

- Cheap inner channel: `npm run build`.
- Per-criterion verifier: the `verifier` field on each criterion in `loop/ACCEPTANCE.md`.
- Final-verify: `npm run build`.

## Dependency topology

All criteria are independent, except AC-003 and AC-004 depend on AC-002 because UI calls need the background integration surface.

Selection order: unmet dependencies first, then strongest failing evidence, then cheapest verifier feedback, then highest regression risk.

## Iteration protocol

1. Read `loop/ACCEPTANCE.md`, `loop/STATE.md`, latest verification artifacts, and the source authority files. Confirm the goal version still matches the frozen inventory.
2. Oracle integrity check before editing:
   - criteria text unchanged except `status` / `last_verification`,
   - verifiers unchanged except via approved Oracle Change Notes,
   - no skipped / xfailed selectors added,
   - no expected evidence weakened.
3. If every criterion is `PASS_PENDING_FINAL` or `PASS`, run the final verify. If it proves the whole inventory in the same repo state: set all to `PASS`, write `loop/VERIFY.md` with the matrix, emit `criteria-met` then `stop-and-summarize`.
4. Otherwise pick one primary failing / `OPEN` criterion by topology, priority, and cheapest verifier feedback.
5. Before editing, write one line in `loop/STATE.md`: `criterion-id | failing-evidence | hypothesis | edit-surface | rollback`.
6. Make one small reversible change. Run the cheap inner channel; if it fails, fix or revert before broader proof.
7. Run the criterion's verifier. Then run impact guards for already passing criteria the edit could disturb.
8. Accept the change only if the criterion moves toward pass or gains sharper failure evidence, no passing criterion regresses, and the oracle was not weakened.
9. If the criterion verifier passes, mark `PASS_PENDING_FINAL`, not `PASS`. `PASS` waits for the next final verify.
10. On 3 consecutive failures with no new evidence, mark the criterion `STUCK` and switch to another unblocked criterion.

## Rules

Scope manifest:

- Allowed globs: `manifest.json`, `package.json`, `package-lock.json`, `README.md`, `src/**`, `loop/**`, `.env.example`.
- Forbidden globs: `dist/**`, `node_modules/**`, secret-bearing env files committed to git, unrelated repositories except read-only context from `C:\Users\gjins\Desktop\studypilot`.

Forbidden shortcuts:

- No `--no-verify`.
- No direct `GEMINI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in extension/browser code.
- No mock AI answer as the normal success path.
- No fake "saved to dashboard" success when Supabase insert fails.
- No weakening academic-integrity prompt rules.
- No changing the main dashboard/backend contract unless this extension cannot integrate with the existing contract.

## Halt conditions

Halt = emit `stop-and-summarize`. Terminal success additionally emits `criteria-met` first. Escalate is rare and irreversible-only.

Halt when:

- all criteria reach `PASS` in the final-verify -> `criteria-met` -> `stop-and-summarize`
- every remaining unpassed criterion is `STUCK` / `BLOCKED_EXTERNAL` / `QUARANTINED` / wrong-loop-shaped -> `partial-deadlock`
- oracle drift is detected and cannot be repaired without authority -> `oracle-drift`
- a genuine irreversible / external blocker prevents proof -> `escalate`

### Halt-cause classifier

When emitting `criteria-met`, `stop-and-summarize`, or `escalate: <reason>`, label:

- `criteria-met` - terminal completion; every criterion in the frozen goal version passed in the final-verify.
- `partial-deadlock` - finite goal not met; remaining criteria are stuck / blocked / quarantined.
- `oracle-drift` - the criteria / verifier / evidence / final-verify cannot be preserved without weakening the acceptance contract.
- `derivation-gap` - blocked on something derivation could have asked for.
- `genuine-escalate` - irreversible / external / authority-needed.
- `wrong-loop` - the work is not terminal goal-shaped and needs re-derivation.

Before any non-terminal halt, scan all acceptance rows and verifier/oracle gaps. A single blocked row is not enough to halt while another reversible in-scope intervention can move a different row.

## Artifacts to maintain

- `loop/ACCEPTANCE.md` - frozen criteria, mutable `status` / `last_verification`.
- `loop/STATE.md` - goal version, iteration, current criterion, stuck counters, Oracle Change Notes, last action, next action.
- `loop/VERIFY.md` - latest final-verify transcript.
- Evidence artifacts: command output, code references, and build logs.

## Repo-specific overlay

StudyPilot extension integration must follow the Supabase architecture manual:

- The extension may only use `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and public URLs.
- The extension requests Gemini Live access through the Supabase `live-token` Edge Function.
- The extension sends text coaching requests through the Supabase `socratic-coach` Edge Function.
- The extension saves sessions to `sessions` and transcript rows to `session_messages`, then calls `summarize-session`.
- The extension must be compatible with both the current stub `{ ephemeralToken, expiresAt }` live-token response and a future real response that includes `accessToken` / `webSocketUrl`.
