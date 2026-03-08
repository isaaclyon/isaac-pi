# LCM Live Eval Sweep — low+medium repeated runs (5 each)

Add a repeatable sweep runner for `stage4-live-eval` to execute **5 runs per effort** for **low + medium**, aggregate recall statistics, enforce a per-effort average-recall gate, and emit both console output and a JSON summary artifact.

## User context

- You observed high variance/surprising failures in single-run live eval and asked to test statistical stability.
- You requested running low and medium together over multiple repetitions (5/7/10 considered).
- Questionnaire decisions:
  - Runs: **5 per effort**
  - Efforts: **low + medium**
  - Gate: **fail if each effort average recall < threshold**
  - Output: **console table + JSON summary file**
- Goal: distinguish real quality behavior from one-off run noise.

## Key acceptance criteria

- [x] Add a sweep execution path that runs live eval **5x for low** and **5x for medium** in one command.
- [x] Reuse existing `stage4-live-eval` behavior/config where possible (no parallel shadow logic drift).
- [x] Aggregate per-effort metrics at minimum:
  - [x] run count
  - [x] mean recall
  - [x] min/max recall
  - [x] pass count / fail count (using existing recall threshold)
- [x] Gate outcome fails if **any effort's mean recall < threshold**.
- [x] Write JSON summary file to a deterministic location (and print path).
- [x] Print concise console summary table for quick comparison.
- [x] Preserve existing single-run flow and existing test suite behavior.

## Known gotchas / risks

- Live models are nondeterministic; small sample sizes can still fluctuate.
- API/network hiccups may create outlier failures (need transparent per-run status).
- Re-running live eval multiplies cost/latency; keep defaults modest.
- If sweep runner copies logic instead of reusing it, behavior can drift over time.
- Codex provider quirks (unsupported params) must continue to be handled consistently.

## Stage-gated implementation plan

### Phase 1 — Contract + RED tests
- [x] Define sweep config contract (runs, efforts list, output path, gate mode).
- [x] Add failing tests for aggregation/gating/output-shape logic in a pure core module.
- [x] Verify RED (tests fail for expected missing behavior).

### Phase 2 — Implement sweep core
- [x] Implement pure helpers for:
  - [x] grouping run results by effort
  - [x] stats computation (mean/min/max/pass-rate)
  - [x] per-effort mean-threshold gate
  - [x] summary JSON shape
- [x] Turn tests GREEN.

### Phase 3 — Wire CLI/script runner
- [x] Add a new script (or `--sweep` mode) that:
  - [x] executes low effort 5 runs
  - [x] executes medium effort 5 runs
  - [x] captures each run's parsed `LIVE_EVAL_JSON`
  - [x] computes aggregate summary
  - [x] prints console table
  - [x] writes summary JSON file
  - [x] exits non-zero when gate fails
- [x] Keep existing single-run command unchanged.

### Phase 4 — Validation + handoff
- [x] Run new unit tests and existing LCM suites.
- [x] Run one real sweep with Codex OAuth in this environment.
- [x] Share output summary, failure interpretation, and recommended next tuning action.
- [x] Stop for your review before any further feature changes.
