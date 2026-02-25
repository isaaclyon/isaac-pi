---
name: feature-dev
description: "Use this skill for multi-file, architecture-heavy features or unclear requirements, before implementation and before finalizing review."
---

# Feature Development

Systematic 7-phase workflow for building features. Understand the codebase deeply, identify ambiguities, design architecture, then implement.

## Core Principles

- **Ask clarifying questions**: Identify all ambiguities and edge cases early. Wait for answers before proceeding.
- **Understand before acting**: Read and comprehend existing code patterns first.
- **Read files thoroughly**: Explore key files with `read`, `bash` (grep/find), and `lsp` before designing.
- **Parallelize with headless pi**: Launch multiple `pi -p "..."` instances in parallel for exploration, architecture, and review — each with a focused prompt and its own context window.
- **Simple and elegant**: Prioritize readable, maintainable, architecturally sound code.
- **Track progress**: Maintain a todo list throughout all phases.

## The 7 Phases

### Phase 1: Discovery

**Goal**: Understand what needs to be built

1. Create a todo list with all phases
2. If feature unclear, ask user:
   - What problem are they solving?
   - What should the feature do?
   - Any constraints or requirements?
3. Summarize understanding and confirm with user

### Phase 2: Codebase Exploration

**Goal**: Understand relevant existing code and patterns

Launch 2-3 headless `pi -p "..."` instances in parallel, each with a focused exploration prompt:

```bash
pi -p "Find features similar to [feature] and trace their implementation end-to-end. List every relevant file and key patterns." &
pi -p "Map the architecture and abstractions for [area]: entry points, data flow, key interfaces." &
pi -p "Read and summarize the current implementation of [existing module/file]." &
wait
```

Read all key files surfaced by these agents to build your own deep understanding. Present a comprehensive summary of findings and patterns.

### Phase 3: Clarifying Questions

**Goal**: Fill in gaps and resolve all ambiguities before designing

**CRITICAL**: This is one of the most important phases. DO NOT SKIP.

1. Review codebase findings and original feature request
2. Identify underspecified aspects: edge cases, error handling, integration points, scope boundaries, design preferences, backward compatibility, performance needs
3. **Present all questions to user in a clear, organized list**
4. **Wait for answers before proceeding**

If user says "whatever you think is best", provide your recommendation and get explicit confirmation.

### Phase 4: Architecture Design

**Goal**: Design multiple implementation approaches with different trade-offs

Launch 2-3 headless `pi -p "..."` instances in parallel, each tasked with a different design lens:

```bash
pi -p "Given [feature] and these files [list], design a minimal-change approach: smallest footprint, maximum reuse of existing patterns. Show key decisions, files changed, trade-offs." &
pi -p "Given [feature] and these files [list], design a clean-architecture approach: maintainability, elegant abstractions, future-proof. Show key decisions, files changed, trade-offs." &
pi -p "Given [feature] and these files [list], design a pragmatic-balance approach: right-sized for the feature, good quality without over-engineering. Show key decisions, files changed, trade-offs." &
wait
```

Review all three outputs and form your own opinion on which fits best.

Present to user:
1. Brief summary of each approach
2. Trade-offs comparison
3. **Your recommendation with reasoning**
4. **Ask user which approach they prefer**

### Phase 5: Implementation

**Goal**: Build the feature

**DO NOT START WITHOUT USER APPROVAL**

1. Wait for explicit user approval on the chosen approach
2. Re-read all relevant files identified in previous phases
3. Implement following chosen architecture
4. Follow codebase conventions strictly
5. Write clean, well-documented code
6. Update todos as you progress

### Phase 6: Quality Review

**Goal**: Ensure code is simple, DRY, elegant, and functionally correct

Launch 3 headless `pi -p "..."` instances in parallel, each reviewing from a different angle:

```bash
pi -p "Review [files] for simplicity, DRY, and elegance. Flag duplication, unnecessary complexity, or cleaner abstractions." &
pi -p "Review [files] for bugs and functional correctness. Check edge cases, error paths, and logic soundness." &
pi -p "Review [files] for project conventions. Check naming, structure, and style against [existing patterns]." &
wait
```

Consolidate findings and identify highest-severity issues. **Present findings to user and ask what they want to do** (fix now, fix later, proceed as-is). Address issues based on user decision.

### Phase 7: Summary

**Goal**: Document what was accomplished

1. Mark all todos complete
2. Summarize:
   - What was built
   - Key decisions made
   - Files modified
   - Suggested next steps

## When to Use

**Use for:**
- New features touching multiple files
- Features requiring architectural decisions
- Complex integrations with existing code
- Features where requirements are unclear

**Don't use for:**
- Single-line bug fixes
- Trivial changes
- Well-defined, simple tasks
- Urgent hotfixes
