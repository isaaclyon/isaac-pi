# Plan: trigger LCM compaction via custom compaction policy

## Goal
Keep the proactive trigger behavior from `pi-custom-compaction` (policy-driven compaction timing and status) while ensuring the actual compaction result comes from `pi-lcm`'s DAG-based compaction pipeline.

## Decision
The user wants `pi-custom-compaction` behavior to trigger compaction, but wants `pi-lcm` to own the compaction implementation.

## Acceptance criteria
1. Proactive compaction can still be triggered from `agent/compaction-policy.json` timing rules.
2. The extension that performs `session_before_compact` compaction is `pi-lcm`, not `pi-custom-compaction`.
3. The solution does not rely on two extensions competing for the same compaction result.
4. Tests cover the trigger-only behavior and verify it does not provide its own compaction payload.

## Plan
1. Inspect current extension load order and event behavior to confirm why the two packages conflict. ✅
2. Add a local trigger-only extension that reuses the policy/trigger semantics needed from `pi-custom-compaction` but never returns a compaction summary. ✅
3. Disable/remove the installed `pi-custom-compaction` package entry so it stops intercepting `session_before_compact`. ✅
4. Add focused tests for trigger decisions and extension event behavior. ✅
5. Run the relevant test suite and verify settings/config behavior. ✅
6. Archive this plan after completion. ✅

## Verification
- `npx vitest run agent/test/extensions/lcm-compaction-trigger.test.ts` ✅
- `npx vitest run agent/test/extensions/custom-footer.test.ts agent/test/extensions/tab-status.test.ts agent/test/extensions/lcm-compaction-trigger.test.ts` ✅
- Note: `npx vitest run agent/test/extensions/*.test.ts` still hits a pre-existing unrelated failure in `agent/test/extensions/questionnaire.test.ts` because `agent/extensions/questionnaire.js` is missing.
