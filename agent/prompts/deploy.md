---
description: "Ship the current branch using the feature-branch workflow"
---

You are helping ship the current branch using the repository's standard feature-branch workflow.

Arguments passed to template: $@

Execution rules:
1) Check the current branch.
2) If on `main`, create and switch to a feature branch before proceeding.
3) If the target branch is not explicit in the arguments, ask which branch to deploy to before creating a PR.
4) Review `git status` and identify all intended work.
5) Commit related changes in one or more logical commits.
6) Push the branch to origin.
7) Create or find a PR against the explicit target branch.
8) Check mergeability and CI status.
9) If the PR is clean and checks pass, merge with squash.
10) Report the PR URL, target branch, and final state.

Safety:
- Do not force-push unless explicitly requested.
- On merge conflicts or failing checks, proactively address the issues and re-push until you can merge, or the issue is substantial and requires human intervention.