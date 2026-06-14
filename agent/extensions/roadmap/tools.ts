/**
 * Native LLM tools for the roadmap board.
 *
 * These give the agent a structured, always-advertised interface to the board: the
 * tool list in the system prompt is how the model learns the board exists and what it
 * may do, and `promptSnippet`/`promptGuidelines` carry the workflow policy that used to
 * live only in the skill. Tools replace hand-built `node cli.js …` shell calls with
 * validated params.
 *
 * Every tool shells out to the SAME validating `cli.js` the `/road` command and the
 * roadmap-board skill use — one core, many faces — so no board logic is duplicated
 * here. The pure param→argv builders (and their tool-side validation) live in
 * tool-args.ts so they unit-test without typebox; this module is the typebox schema +
 * registration layer, and the effectful `execute` handlers run the builders through the
 * injected `runCli`. Errors propagate by throwing: the board's stderr (unknown id,
 * cyclic dep, missing blocked reason) surfaces verbatim, and the agent loop encodes it
 * as an error result — the documented "throw on failure" contract.
 *
 * Registered only in repos that own a board (gated by index.ts at session_start), so
 * board-less repos pay no system-prompt cost.
 */

import type { AgentToolResult, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type SchemaOptions, type Static, Type } from "typebox";
import type { BoardCard, BoardSnapshot } from "./core.ts";
import { buildClaimArgs, buildEpicArgs, buildMoveArgs, buildUpdateArgs, EPIC_OPS, filterByEpic, LIST_VIEWS, STATUSES } from "./tool-args.ts";

export { ROADMAP_TOOL_NAMES } from "./tool-args.ts";

/** A string-literal enum as a TypeBox union (renders as a clean `enum` for the model). */
const Enum = (values: readonly string[], options?: SchemaOptions) =>
	Type.Union(
		values.map((v) => Type.Literal(v)),
		options,
	);

// ---------------------------------------------------------------------------
// Dependency injection (keeps the pure logic in tool-args.ts testable)
// ---------------------------------------------------------------------------

/** Everything the tools need from the host, injected so the pure logic stays testable. */
export interface RoadmapToolDeps {
	/** Run the board CLI (already bound to the resolved project root + cli path) and parse its JSON. */
	runCli: (args: string[]) => Promise<unknown>;
	/** A fresh full board snapshot via the validating CLI. */
	snapshot: () => Promise<BoardSnapshot>;
	/** The claim owner for this session (its stable session id). */
	owner: () => string;
}

const ok = (text: string, details: unknown): AgentToolResult<unknown> => ({
	content: [{ type: "text" as const, text }],
	details,
});

const json = (value: unknown): string => JSON.stringify(value, null, 2);

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

const GetParams = Type.Object({
	id: Type.String({ description: "Card id, e.g. ROAD-006." }),
});

const ListParams = Type.Object({
	view: Enum(LIST_VIEWS, {
		description:
			"list = all cards (optionally filtered); ready = unblocked cards to pick up next; blocked = cards waiting on a dependency; epics = epic progress; timeline = live agent activity.",
	}),
	epic: Type.Optional(Type.String({ description: 'Filter by epic id, or "none" for unassigned (list/ready/blocked).' })),
	status: Type.Optional(Type.String({ description: "Filter the list view by column." })),
	card: Type.Optional(Type.String({ description: "Scope the timeline view to one card id." })),
	limit: Type.Optional(Type.Number({ description: "Max timeline items (default 20)." })),
});

const DocumentSchema = Type.Object({
	title: Type.String(),
	href: Type.String({ description: "Repo-relative path or URL." }),
	kind: Type.Optional(Type.String({ description: "e.g. plan, outcome, review, pr, design, issue." })),
	note: Type.Optional(Type.String({ description: "One-line gloss, not the full body." })),
});

const UpdateParams = Type.Object({
	id: Type.String({ description: "Card id to patch." }),
	title: Type.Optional(Type.String()),
	summary: Type.Optional(
		Type.String({ description: "Concise description of the work — not a running log. Put plans/notes in documents." }),
	),
	depends_on: Type.Optional(
		Type.Array(Type.String(), { description: "Card ids this card depends on (must exist; no cycles/self-links)." }),
	),
	enables: Type.Optional(Type.Array(Type.String(), { description: "Inverse edge: card ids this one unblocks." })),
	blocked_reason: Type.Optional(Type.String()),
	documents: Type.Optional(Type.Array(DocumentSchema, { description: "Ordered references; replaces the card's document list." })),
});

const MoveParams = Type.Object({
	id: Type.String(),
	status: Enum(STATUSES, { description: "Target column. Intended flow: triage→backlog→up_next→in_progress→review→completed." }),
	reason: Type.Optional(Type.String({ description: "Required when moving to blocked." })),
});

const ClaimParams = Type.Object({
	id: Type.String(),
	release: Type.Optional(Type.Boolean({ description: "Release this session's claim instead of claiming." })),
	note: Type.Optional(Type.String({ description: "Short note shown with the claim." })),
	force: Type.Optional(
		Type.Boolean({ description: "Steal a claim held by another session (claim) or override the owner check (release)." }),
	),
});

const EpicParamsSchema = Type.Object({
	op: Enum(EPIC_OPS, {
		description: "add (title), update (id + fields), assign (cardId+epicId), clear (cardId), delete/archive/unarchive (id), reorder (order).",
	}),
	id: Type.Optional(Type.String({ description: "Epic id (update/delete/archive/unarchive)." })),
	cardId: Type.Optional(Type.String({ description: "Card id (assign/clear)." })),
	epicId: Type.Optional(Type.String({ description: "Epic id to assign a card to (assign)." })),
	title: Type.Optional(Type.String()),
	summary: Type.Optional(Type.String()),
	sort_index: Type.Optional(Type.Number()),
	order: Type.Optional(Type.Array(Type.String(), { description: "Every epic id exactly once, in the new order (reorder)." })),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the six board tools on `pi`. Call once, only when a board is present.
 * `deps` is read at execute time, so it stays valid as the attached server changes.
 */
export function registerRoadmapTools(pi: ExtensionAPI, deps: RoadmapToolDeps): void {
	pi.registerTool({
		name: "roadmap_get",
		label: "Roadmap Get",
		description:
			"Read one roadmap card with its full fields (summary, deps, documents, derived ready/dependency_blocked) plus its event history. Read a card with this before refining, planning, executing, or reviewing it.",
		promptSnippet: "Read a roadmap card (ROAD-xxx) with full fields + history before acting on it",
		promptGuidelines: [
			"This project tracks work on a roadmap board. Use roadmap_get to read a card before refining/planning/executing it, and roadmap_list view:ready to pick what to work on next.",
			"Keep a card's summary a concise description; attach plans, outcomes, and review notes as documents (roadmap_update documents) rather than growing the summary.",
			"Status flow is convention: triage→backlog→up_next→in_progress→review→completed (blocked is a side state needing a reason). Capturing new Triage ideas is the human's lane (/road triage) — don't create cards yourself.",
		],
		parameters: GetParams,
		async execute(_id, params: Static<typeof GetParams>) {
			const snap = await deps.snapshot();
			const card = snap.cards.find((c) => c.id === params.id);
			if (!card) throw new Error(`Unknown card: ${params.id}`);
			const events = await deps.runCli(["events", params.id]);
			return ok(json({ card, events }), { tool: "roadmap_get", id: params.id });
		},
	});

	pi.registerTool({
		name: "roadmap_list",
		label: "Roadmap List",
		description:
			"List/query the board. view=list (all cards, filter by status/epic), ready (unblocked cards to start now), blocked (waiting on a dependency), epics (progress), timeline (live agent activity).",
		promptSnippet: "List roadmap cards by view: list | ready | blocked | epics | timeline",
		parameters: ListParams,
		async execute(_id, params: Static<typeof ListParams>) {
			switch (params.view) {
				case "list": {
					const snap = await deps.snapshot();
					let cards = snap.cards;
					if (params.status) cards = cards.filter((c) => c.status === params.status);
					cards = filterByEpic(cards, params.epic);
					return ok(json(cards), { tool: "roadmap_list", view: "list", count: cards.length });
				}
				case "ready": {
					const cards = filterByEpic((await deps.runCli(["ready"])) as BoardCard[], params.epic);
					return ok(json(cards), { tool: "roadmap_list", view: "ready", count: cards.length });
				}
				case "blocked": {
					const cards = filterByEpic((await deps.runCli(["blocked-deps"])) as BoardCard[], params.epic);
					return ok(json(cards), { tool: "roadmap_list", view: "blocked", count: cards.length });
				}
				case "epics": {
					const snap = await deps.snapshot();
					return ok(json(snap.epics), { tool: "roadmap_list", view: "epics", count: snap.epics.length });
				}
				default: {
					const args = ["timeline", "--limit", String(params.limit ?? 20)];
					if (params.card) args.push("--card", params.card);
					return ok(json(await deps.runCli(args)), { tool: "roadmap_list", view: "timeline" });
				}
			}
		},
	});

	pi.registerTool({
		name: "roadmap_update",
		label: "Roadmap Update",
		description:
			"Patch a card's title, summary, dependencies (depends_on/enables), blocked_reason, or documents. The main editing verb. depends_on/enables reference existing card ids and may not form cycles or self-links; documents replaces the card's reference list.",
		promptSnippet: "Edit a roadmap card: title, summary, dependencies, or attached documents",
		parameters: UpdateParams,
		async execute(_id, params: Static<typeof UpdateParams>) {
			const { id, ...patch } = params;
			const card = await deps.runCli(buildUpdateArgs(id, patch));
			return ok(json(card), { tool: "roadmap_update", id });
		},
	});

	pi.registerTool({
		name: "roadmap_move",
		label: "Roadmap Move",
		description:
			"Move a card to another column. Intended flow: triage→backlog→up_next→in_progress→review→completed. Moving to blocked requires a reason. Any column can move to any other — you own sane progression.",
		promptSnippet: "Move a roadmap card between columns (blocked requires a reason)",
		parameters: MoveParams,
		async execute(_id, params: Static<typeof MoveParams>) {
			const card = await deps.runCli(buildMoveArgs(params.id, params.status, params.reason));
			return ok(json(card), { tool: "roadmap_move", id: params.id, status: params.status });
		},
	});

	pi.registerTool({
		name: "roadmap_claim",
		label: "Roadmap Claim",
		description:
			"Advisory ownership claim so concurrent agents see who holds a card (never blocks a write). Claims as this session; set release:true to drop your claim. force steals another session's claim or overrides the owner check on release.",
		promptSnippet: "Claim/release a roadmap card so concurrent agents can coordinate",
		parameters: ClaimParams,
		async execute(_id, params: Static<typeof ClaimParams>) {
			const card = await deps.runCli(
				buildClaimArgs({ id: params.id, owner: deps.owner(), release: params.release, note: params.note, force: params.force }),
			);
			return ok(json(card), { tool: "roadmap_claim", id: params.id, release: !!params.release });
		},
	});

	pi.registerTool({
		name: "roadmap_epic",
		label: "Roadmap Epic",
		description:
			"Manage epics. op: add (title[, summary]), update (id + title/summary/sort_index), assign (cardId+epicId), clear (cardId), delete (id), archive/unarchive (id), reorder (order = every epic id once). Use roadmap_list view:epics to read epics.",
		promptSnippet: "Create/edit/assign/archive/reorder roadmap epics",
		parameters: EpicParamsSchema,
		async execute(_id, params: Static<typeof EpicParamsSchema>) {
			const op = params.op as (typeof EPIC_OPS)[number];
			const result = await deps.runCli(buildEpicArgs(op, params));
			return ok(json(result), { tool: "roadmap_epic", op });
		},
	});
}
