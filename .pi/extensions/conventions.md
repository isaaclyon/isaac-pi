# Coding Conventions

## Tech defaults
- Use **TypeScript** as the default language.
- Keep TypeScript strictness as high as possible:
  - `strict: true`
  - `noImplicitAny: true`
  - `strictNullChecks: true`
  - `strictFunctionTypes: true`
  - `strictPropertyInitialization: true`
  - `noImplicitReturns: true`
  - `noFallthroughCasesInSwitch: true`
  - `exactOptionalPropertyTypes: true`
  - `noUncheckedIndexedAccess: true`
- Prefer small, readable files:
  - Aim for **under 350 lines** of code per file when possible.
  - If a file must be larger, split it into smaller files by responsibility.

## Communication style
- The user is not a developer: use plain, practical, easy-to-follow language.
- Keep explanations short and focused on what is happening and why.

## Implementation process
- Before implementing changes, ask clarifying questions if requirements are unclear.
- Favor safe, incremental updates.
- Prefer explicit types and clear naming.

## Collaboration habits
- Use **Conventional Commits** for all commits (for example: `feat: add search filter`, `fix: handle empty response`, `docs: update AGENTS instructions`).
- Use the `gh` CLI for GitHub actions where possible (for example opening PRs, checking status, creating issues, reading PRs).
