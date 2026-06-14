/**
 * Pure param → board-CLI argv builders for the native roadmap tools.
 *
 * Kept dependency-free (only a type-only import) so it unit-tests under plain
 * `node --test`, exactly like core.ts. The typebox schemas and tool registration that
 * consume these live in tools.ts. These builders own the tool-side validation; the
 * board's own cli.js re-validates everything, so this is a fast/clear first line, not
 * the security boundary.
 */

import type { BoardCard } from "./core.ts";

export const STATUSES = ["triage", "backlog", "up_next", "in_progress", "blocked", "review", "completed"] as const;
export const LIST_VIEWS = ["list", "ready", "blocked", "epics", "timeline"] as const;
export const EPIC_OPS = ["add", "update", "assign", "clear", "delete", "archive", "unarchive", "reorder"] as const;

export const ROADMAP_TOOL_NAMES = [
	"roadmap_get",
	"roadmap_list",
	"roadmap_update",
	"roadmap_move",
	"roadmap_claim",
	"roadmap_epic",
] as const;

export interface UpdatePatch {
	title?: string;
	summary?: string;
	depends_on?: string[];
	enables?: string[];
	blocked_reason?: string;
	documents?: Array<{ title: string; href: string; kind?: string; note?: string }>;
}

/** `update <id> <json>` — drops undefined fields; throws when the patch is empty. */
export function buildUpdateArgs(id: string, patch: UpdatePatch): string[] {
	if (!id) throw new Error("roadmap_update requires an id.");
	const clean: UpdatePatch = {};
	if (patch.title !== undefined) clean.title = patch.title;
	if (patch.summary !== undefined) clean.summary = patch.summary;
	if (patch.depends_on !== undefined) clean.depends_on = patch.depends_on;
	if (patch.enables !== undefined) clean.enables = patch.enables;
	if (patch.blocked_reason !== undefined) clean.blocked_reason = patch.blocked_reason;
	if (patch.documents !== undefined) clean.documents = patch.documents;
	if (Object.keys(clean).length === 0) {
		throw new Error(
			"roadmap_update needs at least one field to change (title, summary, depends_on, enables, blocked_reason, documents).",
		);
	}
	return ["update", id, JSON.stringify(clean)];
}

/** `move <id> <status> [reason]` — validates the column; `blocked` requires a reason. */
export function buildMoveArgs(id: string, status: string, reason?: string): string[] {
	if (!id) throw new Error("roadmap_move requires an id.");
	if (!(STATUSES as readonly string[]).includes(status)) {
		throw new Error(`Unknown status "${status}". Valid: ${STATUSES.join(", ")}.`);
	}
	if (status === "blocked" && !reason?.trim()) {
		throw new Error("Moving a card to blocked requires a reason.");
	}
	return reason !== undefined ? ["move", id, status, reason] : ["move", id, status];
}

/**
 * `claim`/`release <id> <owner> [note] [--force]`. The owner is always this session, so
 * a session releases its own claim by default; `force` is needed to steal/override.
 */
export function buildClaimArgs(opts: { id: string; owner: string; release?: boolean; note?: string; force?: boolean }): string[] {
	if (!opts.id) throw new Error("roadmap_claim requires an id.");
	if (!opts.owner) throw new Error("roadmap_claim has no session owner to attribute the claim to.");
	const force = opts.force ? ["--force"] : [];
	if (opts.release) return ["release", opts.id, opts.owner, ...force];
	const note = opts.note !== undefined ? [opts.note] : [];
	return ["claim", opts.id, opts.owner, ...note, ...force];
}

export interface EpicParams {
	id?: string;
	cardId?: string;
	epicId?: string;
	title?: string;
	summary?: string;
	sort_index?: number;
	order?: string[];
}

/** Map a coarse epic `op` onto the board's specific epic verbs; validates required params. */
export function buildEpicArgs(op: (typeof EPIC_OPS)[number], p: EpicParams): string[] {
	const need = (value: string | undefined, name: string): string => {
		if (!value) throw new Error(`roadmap_epic op "${op}" requires ${name}.`);
		return value;
	};
	switch (op) {
		case "add":
			return ["epic-add", need(p.title, "title"), ...(p.summary !== undefined ? [p.summary] : [])];
		case "update": {
			const id = need(p.id, "id");
			const patch: Record<string, unknown> = {};
			if (p.title !== undefined) patch.title = p.title;
			if (p.summary !== undefined) patch.summary = p.summary;
			if (p.sort_index !== undefined) patch.sort_index = p.sort_index;
			if (Object.keys(patch).length === 0) {
				throw new Error('roadmap_epic op "update" needs at least one of title, summary, sort_index.');
			}
			return ["epic-update", id, JSON.stringify(patch)];
		}
		case "assign":
			return ["assign-epic", need(p.cardId, "cardId"), need(p.epicId, "epicId")];
		case "clear":
			return ["clear-epic", need(p.cardId, "cardId")];
		case "delete":
			return ["epic-delete", need(p.id, "id")];
		case "archive":
			return ["epic-archive", need(p.id, "id")];
		case "unarchive":
			return ["epic-unarchive", need(p.id, "id")];
		case "reorder": {
			if (!p.order?.length) throw new Error('roadmap_epic op "reorder" requires order (every epic id, once).');
			return ["reorder-epics", p.order.join(",")];
		}
	}
}

/** Filter a slim card list by epic, honoring `"none"` = unassigned (mirrors `/road`). */
export function filterByEpic(cards: BoardCard[], epic?: string): BoardCard[] {
	if (!epic) return cards;
	if (epic === "none") return cards.filter((c) => !c.epic_id);
	return cards.filter((c) => c.epic_id === epic);
}
