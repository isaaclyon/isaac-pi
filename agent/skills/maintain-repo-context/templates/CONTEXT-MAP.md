# Context Map

This repo has more than one bounded context. This file explains the topology.

## Shared kernel

- Root `CONTEXT.md` owns:

## Contexts

- `<path or package>` — local `CONTEXT.md` owns:
- `<path or package>` — local `CONTEXT.md` owns:

## Relationships

- `<context A>` provides:
- `<context B>` composes:
- Data flow is distinct from code dependency when applicable.

## Cross-context term translations

- `"<word>"` in `<context A>` means ...; in `<context B>` it means ...
- `"<word>"` is ambiguous unless qualified as ...
