---
name: use-gh-cli
description: "Interact with GitHub using the `gh` CLI. Use `gh issue`, `gh pr`, `gh repo`, `gh run`, and `gh api` for issues, PRs, CI runs, repositories, users, and advanced queries."
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git directory, or use URLs directly.

## Repositories (including other people's repos)

View a repo (private or public) without cloning:
```bash
gh repo view owner/repo
```

Open a repo in your browser:
```bash
gh repo view owner/repo --web
```

Clone someone else’s repo:
```bash
gh repo clone other-owner/project
```

Fork someone else’s repo and clone it locally:
```bash
gh repo fork other-owner/project --clone=true --remote=true
```

List repos for a user/org:
```bash
gh repo list other-owner --limit 20
```

Search GitHub repositories:
```bash
gh search repos "user:other-owner language:typescript" --limit 20
```

## Pull Requests

Check CI status on a PR:
```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs:
```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:
```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:
```bash
gh run view <run-id> --repo owner/repo --log-failed
```

## API for Advanced Queries

The `gh api` command is useful for accessing data not available through other subcommands.

Get PR with specific fields:
```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

Get a user profile:
```bash
gh api users/someone --jq '.login, .name, .bio, .public_repos'
```

## JSON Output

Most commands support `--json` for structured output. You can use `--jq` to filter:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```