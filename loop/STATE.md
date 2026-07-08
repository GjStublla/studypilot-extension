# Loop State - extension-ai-v1

```yaml
archetype: goal
identity: StudyPilot extension AI integration loop
primitive_bundle:
  target-shape: finite-criteria
  halt-shape: terminal
  artifact-shape: acceptance-inventory
  convergence-shape: criteria-completion
  cadence-shape: sync
divergences: []
overlays: []
consult_tier: tier-0
evaluator_tier: n/a
derivation_read_set:
  - C:\Users\gjins\.codex\skills\loopgen\SKILL.md
  - C:\Users\gjins\.codex\skills\loopgen\templates\composed-prompt.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\target-shape.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\halt-shape.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\artifact-shape.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\convergence-shape.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\cadence-shape.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\consult-capability.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\frontload-audit.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\runner-contract.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\judgment-default.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\evidence-tier.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\halt-cause-classifier.md
  - C:\Users\gjins\.codex\skills\loopgen\primitives\queue-as-second-artifact.md
  - C:\Users\gjins\.codex\skills\loopgen\archetypes\goal.md
  - C:\Users\gjins\.codex\skills\loopgen\templates\bodies\goal-body.md
  - C:\Users\gjins\.codex\skills\loopgen\references\oracle-principles.md
  - C:\Users\gjins\Desktop\studypilot\context\supabase\supabase.md
  - C:\Users\gjins\Downloads\maturamentor_ai_skeleton_bundle\maturamentor_ai_skeleton\AI_VERTEX_EXTRACTION.md
  - C:\Users\gjins\Downloads\maturamentor_ai_skeleton_bundle\maturamentor_ai_skeleton\ai_vertex_reference_bundle\docs\09_LIVE_TUTOR_DESIGN.md
  - C:\Users\gjins\Downloads\maturamentor_ai_skeleton_bundle\maturamentor_ai_skeleton\ai_vertex_reference_bundle\docs\06_GEMINI_AI_LAYER.md
frontload:
  resolved:
    - extension repository path
    - Supabase architecture source
    - public env variable names
    - AI reference bundle
    - build verifier command
  defaulted:
    - stuck-attempt N=3
    - all criteria independent except UI criteria depending on background integration
    - no programmatic consult
  open_gaps:
    - production runtime verification requires a real user session stored in the extension
artifacts:
  canonical:
    prompt: loop/PROMPT.md
    state: loop/STATE.md
    acceptance: loop/ACCEPTANCE.md
    verify: loop/VERIFY.md
  repo_aliases: {}
iteration: 1
phase: verified
current_artifact: loop/ACCEPTANCE.md
last_action: implemented Supabase-backed extension AI/session integration and ran final verify
next_action: stop-and-summarize
halt_cause: criteria-met
halt_scan: all six acceptance rows PASS after final npm run build and grep checks
goal_version: extension-ai-v1
current_criterion: null
stuck_counters: {}
final_verify: "PASS - npm run build completed successfully at 2026-07-07T22:32:37+02:00"
oracle_change_notes: []
```
