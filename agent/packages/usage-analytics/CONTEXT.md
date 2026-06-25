# Usage Analytics Package

A Pi package that records durable usage facts about explicit skill invocations and tool executions, then exposes a query skill and CLI for answering analytics questions across the current repo or all repos.

## Language

**Usage Analytics Package**:
The installable Pi package rooted at `agent/packages/usage-analytics/` that bundles the collector extension, query skill, and query CLI.
_Avoid_: telemetry system, dashboard package

**Collector Extension**:
The always-on Pi extension that listens to runtime events and appends usage facts into SQLite.
_Avoid_: reporter, dashboard

**Query Skill**:
The on-demand Pi skill that tells the agent how to answer analytics questions from the recorded SQLite database.
_Avoid_: collector, hook

**Usage Fact**:
One recorded event row, not a precomputed counter.
_Avoid_: metric blob, summary row

**Skill Invocation**:
An explicit `/skill:name` command observed in raw user input before Pi expands the skill.
_Avoid_: implicit model skill usage, guessed skill use

**Tool Execution**:
A completed Pi tool call recorded from the runtime tool execution lifecycle.
_Avoid_: prompt mention, tool availability

**Tool Provenance**:
Whether a recorded tool execution came from an extension-provided tool or from Pi's non-extension tool surface.
_Avoid_: sdk jargon, internal-only source labels

**Repo Scope**:
The grouping dimension keyed by the resolved git repo root for an event, or `NULL` when no repo root exists.
_Avoid_: cwd-only scope, project guess

**Current Repo Scope**:
A query filtered to the repo root resolved from the caller's current working directory.
_Avoid_: current folder, active package

**All Repos Scope**:
A query that ignores repo filtering and aggregates across every recorded repo root plus non-repo events.
_Avoid_: workspace-only scope

**Canned View**:
A named SQL-backed report such as summary, tools, skills, failures, or repos.
_Avoid_: dashboard tab, saved search

**Read-only SQL Escape Hatch**:
A controlled way to run ad hoc `SELECT` queries against the usage database when canned views are insufficient.
_Avoid_: arbitrary SQL, admin console

## Relationships

- The **Usage Analytics Package** contains exactly one **Collector Extension** and one **Query Skill** in v1.
- The **Collector Extension** records many **Usage Facts**.
- A **Usage Fact** is either a **Skill Invocation** or a **Tool Execution**.
- Every recorded **Usage Fact** stores the original `cwd` and the resolved **Repo Scope**.
- A **Skill Invocation** is counted only when the raw input contains an explicit `/skill:name` command.
- A **Tool Execution** is counted only when Pi emits a completed tool execution lifecycle event.
- Every **Tool Execution** stores **Tool Provenance** as `extension` or `non_extension` in v1.
- **Canned Views** are derived from **Usage Facts**, not maintained as separate counters.
- The **Query Skill** prefers **Canned Views** before using the **Read-only SQL Escape Hatch**.
- **Current Repo Scope** and **All Repos Scope** are query filters over the same underlying **Usage Facts**.
- Extension tools are identified from tool source metadata, not by naming convention.

## Invariants

- The package does not guess implicit skill usage.
- The collector writes append-only facts; reports are derived at query time.
- Repo scoping is decided at write time and stored on each fact.
- Ad hoc SQL must stay read-only.
- Canned views must work without the agent knowing SQL.
