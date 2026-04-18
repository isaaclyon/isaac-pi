# Vendor pi-review-loop locally

## Goal
Make the `pi-review-loop` extension load from a local vendored checkout in this repo so it can be edited and tested without pulling from the remote GitHub URL.

## Plan
1. Add local provenance documentation next to the vendored checkout so the source and upstream version are easy to recover later.
2. Update `agent/settings.json` to point at the local vendored path instead of the remote GitHub package reference.
3. Verify the package path resolves and the remote package reference is gone from the active config.

## Verification
- `agent/settings.json` points at the local checkout under `agent/git/github.com/nicobailon/pi-review-loop`.
- A repo-wide search no longer finds the remote `pi-review-loop` package reference in active config.
