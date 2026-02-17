# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add MCPorter integrations for delegated agent workflows
- Add project-level agent definitions plus `#agent` dispatch commands
- Add interactive shell and runtime reload extensions
- Add portable standard hooks with agent-end checks, autofix steps, and uv-based Python validation
- Add a default skills reminder before agent responses
- Add install-time sync for packaged `.pi` resources (agents, prompts, hooks) into target repos
- Add `/clean`, `/commit`, and `/dirty` git workflow prompt commands
- Add web search, fetch, and git workflow prompt templates
- Add package pi setup (extensions, skills, prompts, settings) for cross-repo reuse
- Add a `tmux` skill for safe managed-session tmux workflows

### Changed

- Improve agent-end output with clearer summaries when hook checks fail
- Update conventions and AGENTS routing docs for tools, skills, and prompts
- Replace subagent-specific tmux runtime planning with a simpler tmux-capabilities plan

### Removed

- Remove `extensions/pi-subagent` in favor of a skill-first tmux approach

### Fixed

- Ensure postinstall sync writes packaged agents to the repo `.pi/` root for both `pi install -l npm:...` and `pi install -l git:...` installs (without creating duplicate prompt collisions)
- Ensure `pi-agent-scip` dependencies install during package postinstall
- Fix shared extensions to use portable dependencies
- Drop unnecessary scip npm dependency from package config

[Unreleased]: https://github.com/isaaclyon/isaac-pi/compare/HEAD...HEAD
