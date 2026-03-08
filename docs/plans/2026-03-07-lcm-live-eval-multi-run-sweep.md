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

- [ ] Add a sweep execution path that runs live eval **5x for low** and **5x for medium** in one command.
- [ ] Reuse existing `stage4-live-eval` behavior/config where possible (no parallel shadow logic drift).
- [ ] Aggregate per-effort metrics at minimum:
  - [ ] run count
  - [ ] mean recall
  - [ ] min/max recall
  - [ ] pass count / fail count (using existing recall threshold)
- [ ] Gate outcome fails if **any effort's mean recall < threshold**.
- [ ] Write JSON summary file to a deterministic location (and print path).
- [ ] Print concise console summary table for quick comparison.
- [ ] Preserve existing single-run flow and existing test suite behavior.

## Known gotchas / risks

- Live models are nondeterministic; small sample sizes can still fluctuate.
- API/network hiccups may create outlier failures (need transparent per-run status).
- Re-running live eval multiplies cost/latency; keep defaults modest.
- If sweep runner copies logic instead of reusing it, behavior can drift over time.
- Codex provider quirks (unsupported params) must continue to be handled consistently.

## Stage-gated implementation plan

### Phase 1 — Contract + RED tests
- [ ] Define sweep config contract (runs, efforts list, output path, gate mode).
- [ ] Add failing tests for aggregation/gating/output-shape logic in a pure core module.
- [ ] Verify RED (tests fail for expected missing behavior).

### Phase 2 — Implement sweep core
- [ ] Implement pure helpers for:
  - [ ] grouping run results by effort
  - [ ] stats computation (mean/min/max/pass-rate)
  - [ ] per-effort mean-threshold gate
  - [ ] summary JSON shape
- [ ] Turn tests GREEN.

### Phase 3 — Wire CLI/script runner
- [ ] Add a new script (or `--sweep` mode) that:
  - [ ] executes low effort 5 runs
  - [ ] executes medium effort 5 runs
  - [ ] captures each run's parsed `LIVE_EVAL_JSON`
  - [ ] computes aggregate summary
  - [ ] prints console table
  - [ ] writes summary JSON file
  - [ ] exits non-zero when gate fails
- [ ] Keep existing single-run command unchanged.

### Phase 4 — Validation + handoff
- [ ] Run new unit tests and existing LCM suites.
- [ ] Run one real sweep with Codex OAuth in this environment.
- [ ] Share output summary, failure interpretation, and recommended next tuning action.
- [ ] Stop for your review before any further feature changes.
