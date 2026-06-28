# Repo Contract

This file documents where durable and temporary repo knowledge lives.

## Source-of-truth map

| Fact type | Owner |
| --- | --- |
| Orientation | `README.md` |
| Architecture | `ARCHITECTURE.md` |
| Shared language | `CONTEXT.md` |
| Multi-context topology | `CONTEXT-MAP.md` |
| Local dialect | local `CONTEXT.md` |
| Durable decisions | ADR folder |
| Medium-term sequencing | `ROADMAP.md` |
| Temporary implementation state | `docs/plans/` |
| Engineering standards | `docs/guidelines/` |
| Agent/dev workflow | `AGENTS.md` / `CLAUDE.md` |
| Local ADR enforcement rationale | code comments with ADR references |

## Local conventions

- ADR folder path:
- Single-context or multi-context:
- Important package/context roots:
- Roadmap path:
- Implementation-plan path and archive policy:
- Agent instruction file(s):
- Review or doc-update expectations:

## Routing rules

- Terms go to context files.
- Durable trade-off decisions go to ADRs.
- Current system shape goes to architecture.
- Medium-term sequencing goes to roadmap.
- Temporary execution state goes to implementation plans.
- Agent workflow rules go to agent instructions.
- Non-obvious enforcement seams may get terse ADR comments in code.

## Notes

- Add repo-specific exceptions here instead of hiding them in prompts.
