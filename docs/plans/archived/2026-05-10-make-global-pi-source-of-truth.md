# Make ~/.pi the isaac-pi Source of Truth

## Goal

Use `/Users/isaaclyon/.pi` as the actual git working tree for `git@github.com:isaaclyon/isaac-pi.git`, then retire the old local mirror at `/Users/isaaclyon/Developer/personal/isaac-pi`.

## Safety constraints

- Do not track runtime/secrets: `agent/auth.json`, sessions, LCM databases, memory DBs, installed package clones, npm caches, update cache.
- Preserve the existing GitHub history from `isaaclyon/isaac-pi`.
- Do not delete the old local mirror until the new `~/.pi` working tree is verified and the user confirms deletion.

## Steps

1. Copy the repo metadata files that define portable tracking (`.gitignore`, `README.md`) from the old mirror into `~/.pi` if missing/stale.
2. Initialize git in `~/.pi`, add `origin`, fetch `origin/main`, and attach local `main` to `origin/main` without overwriting the live working tree.
3. Inspect `git status --short --ignored` to ensure secrets/runtime paths are ignored.
4. Stage portable live changes from `~/.pi`, especially the new `ci-watch` extension and current settings.
5. Commit the convergence change.
6. Push to `origin/main`.
7. After explicit user confirmation, delete `/Users/isaaclyon/Developer/personal/isaac-pi`.

## Verification

- `git status` in `~/.pi` shows only expected portable changes before commit.
- `git ls-files` does not include known secret/runtime paths.
- Tests for `ci-watch` pass before commit.
- After push, `git status --short --branch` shows `main...origin/main` clean.
