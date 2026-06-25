---
status: accepted
---

# Split collection from query

## Context

We want one Pi-facing feature that can answer usage questions such as top skills, extension tool usage, failures, and repo-scoped comparisons. A skill alone is not enough because skills are invoked on demand and cannot passively observe Pi runtime events. An extension alone is not enough because raw event capture is not a good human query surface.

## Decision

Build the feature as one Pi package with two roles:

- an always-on collector extension that records append-only usage facts into SQLite
- an on-demand query skill backed by a small read-only query CLI

The extension records explicit `/skill:name` invocations from the `input` event and completed tool executions from Pi's tool execution lifecycle. The skill teaches the agent how to answer analytics questions from that database, preferring canned reports and falling back to read-only `SELECT` queries when needed.

## Considered Options

- Skill only: rejected because it cannot observe runtime events unless a user explicitly invokes it at the right moment.
- Extension only: rejected because it would leave the user with logs but no stable natural-language query surface.
- Precomputed counters in JSON: rejected because repo slicing, failure analysis, and new views become awkward immediately.

## Consequences

- The package stays installable as one unit while keeping observation and explanation separate.
- SQLite becomes the durable source of truth for analytics questions.
- We explicitly do not claim to measure implicit model skill usage.
