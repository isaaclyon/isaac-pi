---
name: improve-code
description: "Improve production code and architecture while preserving behavior: simplify recently changed code, find deepening opportunities, and make refactoring decisions precise and testable. Use after implementation, during refactoring, or when the user asks to improve architecture or maintainability."
---

# Improve Code

Improve code at the smallest useful scope. Preserve behavior unless the user explicitly asks for a behavior change. Prefer clearer modules, stronger seams, better locality, and higher-leverage interfaces over cosmetic rewrites.

If the user provides an argument, treat it as the focus area. Otherwise focus on recently changed code for simplification, or the relevant subsystem for architecture work.

## Simplification pass

Use after writing or modifying production code, before finalizing a change, or when a diff feels dense. Follow project conventions and optimize for clarity over brevity:

- reduce unnecessary nesting and branching
- remove redundant abstractions or dead indirection
- consolidate duplication only when it improves readability
- improve names and remove comments that merely restate code
- avoid clever one-liners and nested ternaries

Keep scope tight. Do not change outputs, side effects, interfaces, or behavior; do not collapse distinct responsibilities or remove abstractions that provide meaningful structure. For non-trivial diffs, use the available read-only complexity, duplication, and YAGNI reviewers before editing. Re-check parity and convention alignment afterward.

## Architecture vocabulary

Use these terms consistently in architecture suggestions:

- **Module** — anything with an interface and an implementation.
- **Interface** — everything a caller must know: types, invariants, errors, ordering, and configuration.
- **Depth** — substantial behavior behind a small interface; shallow modules expose nearly as much complexity as they contain.
- **Seam** — where an interface lives and behavior can be altered without editing callers in place.
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers gain from depth. **Locality** — what maintainers gain when change and knowledge stay concentrated.

Use the project's domain language for concepts and [LANGUAGE.md](LANGUAGE.md) for architecture terms. The deletion test helps identify shallow modules: if deleting a module merely moves complexity, it was probably pass-through; if complexity reappears across callers, it was earning its keep. One adapter suggests a hypothetical seam; two adapters make it real.

## Architecture improvement workflow

1. Read the relevant `CONTEXT.md`, `CONTEXT-MAP.md`, ADRs, and architecture docs before exploring.
2. Explore organically and note where understanding a concept requires bouncing across modules, seams leak, tests are hard to write through the current interface, or pure functions hide bugs in their callers.
3. Present numbered opportunities with **files**, **problem**, **solution**, **benefits**, and test impact. Do not propose interfaces yet; ask which candidate to explore.
4. Once selected, work through constraints, dependencies, the deepened module's shape, seam ownership, and surviving tests. Do not relitigate an ADR unless the friction is real.
5. Make the smallest behavior-preserving change, with a regression test or other concrete verification where appropriate.

## Plan and terminology stress-test

When a refactoring plan is fuzzy, terminology is overloaded, boundaries are contested, or code disagrees with the stated behavior, run a focused stress-test before changing code:

- inspect the repo's context, ADR, architecture, roadmap, plan, guideline, and agent-instruction surfaces first
- ask targeted questions only where code and docs cannot answer, one decision at a time with a recommended answer
- test ownership, lifecycle, boundary, and failure behavior with concrete scenarios
- cross-check claims against implementation and surface contradictions
- update durable terms inline in the owning context file; route decisions to ADRs, current shape to architecture docs, sequencing to the roadmap, and temporary checklists to implementation plans
- finish by summarizing resolved terms, decisions, documentation changes, remaining questions, and intentionally skipped ADRs

Use [CONTEXT-FORMAT.md](../repo-intelligence/references/CONTEXT-FORMAT.md) and [ADR-FORMAT.md](../repo-intelligence/references/ADR-FORMAT.md) when local repo conventions do not provide formats. Offer an ADR only when the decision is hard to reverse, surprising without context, and based on a real trade-off.

## Done criteria

- Behavior is unchanged unless explicitly requested otherwise.
- The result is clearer, more local, and no more complex than before.
- Architecture proposals use repo vocabulary and respect documented decisions.
- Relevant tests or checks pass, and documentation deltas have a clear owner.
