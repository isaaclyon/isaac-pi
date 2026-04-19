# Review loop footer status streaming

## Goal
Stream live file-edit progress from the headless review worker into the review-loop footer status bit, using a rolling summary of files touched in the current pass.

## Plan
1. Add a failing test that covers worker progress parsing and footer status updates while a review pass is running.
2. Extend the worker runner to parse `tool_result` JSON events for `edit` and `write`, extract touched file paths from the edit diff/details, and expose progress callbacks.
3. Update the review-loop extension to aggregate touched files per pass and set the `review-loop` status to a short rolling summary while the worker is active.
4. Keep the existing final pass notifications and exit behavior unchanged.
5. Run the focused review-loop tests and archive this plan.

## Verification
- Worker runner tests cover live edit-event parsing.
- Review-loop tests cover streaming footer updates and the final cleared status.
- Existing start/stop/pass result behavior still passes.
