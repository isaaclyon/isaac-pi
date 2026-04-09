# Plan: questionnaire final submit shortcut

## Goal
Allow the questionnaire's final submit screen to accept `1` as an additional submit shortcut, and update the on-screen hint text accordingly.

## Acceptance criteria
- On the final questionnaire submit screen, pressing `1` submits when all questions are answered.
- Existing Enter-to-submit behavior remains unchanged.
- If submission is blocked because answers are missing, the same guardrails still apply.
- The final submit screen text tells the user they can press Enter or 1 to submit.
- Automated test coverage exists for the new submit shortcut parsing/behavior.

## Approach
1. Inspect the questionnaire extension's input handling and final submit rendering.
2. Add a small, testable helper for detecting the final-screen submit shortcut.
3. Write a failing test for `1` being accepted as a final submit shortcut.
4. Implement the minimal production change.
5. Run the relevant test file, then archive this plan after completion.
