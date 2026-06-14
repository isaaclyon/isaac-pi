import assert from "node:assert/strict";
import test from "node:test";
import type { BoardCard } from "./core.ts";
import { buildAddArgs, buildClaimArgs, buildEpicArgs, buildMoveArgs, buildUpdateArgs, filterByEpic } from "./tool-args.ts";

test("buildAddArgs creates an agent-attributed triage card and requires a non-empty title", () => {
	assert.deepEqual(buildAddArgs("New work"), ["agent-add", "New work"]);
	assert.deepEqual(buildAddArgs("New work", "details"), ["agent-add", "New work", "details"]);
	assert.throws(() => buildAddArgs(""), /non-empty title/);
	assert.throws(() => buildAddArgs("   "), /non-empty title/);
});

test("buildUpdateArgs keeps provided fields and drops undefined ones", () => {
	const args = buildUpdateArgs("ROAD-006", { summary: "s", depends_on: ["ROAD-001"], title: undefined });
	assert.equal(args[0], "update");
	assert.equal(args[1], "ROAD-006");
	assert.deepEqual(JSON.parse(args[2]), { summary: "s", depends_on: ["ROAD-001"] });
});

test("buildUpdateArgs serializes documents as an ordered array", () => {
	const docs = [{ title: "Plan", href: "docs/p.md", kind: "plan" }];
	const args = buildUpdateArgs("ROAD-006", { documents: docs });
	assert.deepEqual(JSON.parse(args[2]), { documents: docs });
});

test("buildUpdateArgs throws on an empty patch and a missing id", () => {
	assert.throws(() => buildUpdateArgs("ROAD-006", {}), /at least one field/);
	assert.throws(() => buildUpdateArgs("", { title: "x" }), /requires an id/);
});

test("buildMoveArgs validates the column and appends a reason", () => {
	assert.deepEqual(buildMoveArgs("ROAD-006", "up_next"), ["move", "ROAD-006", "up_next"]);
	assert.deepEqual(buildMoveArgs("ROAD-006", "blocked", "waiting on infra"), ["move", "ROAD-006", "blocked", "waiting on infra"]);
});

test("buildMoveArgs rejects an unknown column and a reasonless block", () => {
	assert.throws(() => buildMoveArgs("ROAD-006", "done"), /Unknown status/);
	assert.throws(() => buildMoveArgs("ROAD-006", "blocked"), /requires a reason/);
	assert.throws(() => buildMoveArgs("ROAD-006", "blocked", "  "), /requires a reason/);
});

test("buildClaimArgs claims as the owning session and appends a note", () => {
	assert.deepEqual(buildClaimArgs({ id: "ROAD-006", owner: "sess-1" }), ["claim", "ROAD-006", "sess-1"]);
	assert.deepEqual(buildClaimArgs({ id: "ROAD-006", owner: "sess-1", note: "mine" }), ["claim", "ROAD-006", "sess-1", "mine"]);
});

test("buildClaimArgs releases and threads --force through", () => {
	assert.deepEqual(buildClaimArgs({ id: "ROAD-006", owner: "sess-1", release: true }), ["release", "ROAD-006", "sess-1"]);
	assert.deepEqual(buildClaimArgs({ id: "ROAD-006", owner: "sess-1", force: true }), ["claim", "ROAD-006", "sess-1", "--force"]);
	assert.deepEqual(buildClaimArgs({ id: "ROAD-006", owner: "sess-1", release: true, force: true }), [
		"release",
		"ROAD-006",
		"sess-1",
		"--force",
	]);
});

test("buildClaimArgs requires an id and an owner", () => {
	assert.throws(() => buildClaimArgs({ id: "", owner: "sess-1" }), /requires an id/);
	assert.throws(() => buildClaimArgs({ id: "ROAD-006", owner: "" }), /session owner/);
});

test("buildEpicArgs maps each op onto the board's specific verb", () => {
	assert.deepEqual(buildEpicArgs("add", { title: "Warehouse" }), ["epic-add", "Warehouse"]);
	assert.deepEqual(buildEpicArgs("add", { title: "Warehouse", summary: "s" }), ["epic-add", "Warehouse", "s"]);
	assert.deepEqual(buildEpicArgs("assign", { cardId: "ROAD-006", epicId: "EPIC-002" }), ["assign-epic", "ROAD-006", "EPIC-002"]);
	assert.deepEqual(buildEpicArgs("clear", { cardId: "ROAD-006" }), ["clear-epic", "ROAD-006"]);
	assert.deepEqual(buildEpicArgs("delete", { id: "EPIC-002" }), ["epic-delete", "EPIC-002"]);
	assert.deepEqual(buildEpicArgs("archive", { id: "EPIC-002" }), ["epic-archive", "EPIC-002"]);
	assert.deepEqual(buildEpicArgs("unarchive", { id: "EPIC-002" }), ["epic-unarchive", "EPIC-002"]);
	assert.deepEqual(buildEpicArgs("reorder", { order: ["EPIC-002", "EPIC-001"] }), ["reorder-epics", "EPIC-002,EPIC-001"]);
});

test("buildEpicArgs update builds a patch and rejects an empty one", () => {
	assert.deepEqual(JSON.parse(buildEpicArgs("update", { id: "EPIC-002", title: "t", sort_index: 3 })[2]), { title: "t", sort_index: 3 });
	assert.throws(() => buildEpicArgs("update", { id: "EPIC-002" }), /at least one of/);
});

test("buildEpicArgs enforces required params per op", () => {
	assert.throws(() => buildEpicArgs("add", {}), /requires title/);
	assert.throws(() => buildEpicArgs("assign", { cardId: "ROAD-006" }), /requires epicId/);
	assert.throws(() => buildEpicArgs("reorder", { order: [] }), /requires order/);
});

test("filterByEpic honors 'none', a specific epic, and the no-filter passthrough", () => {
	const cards = [
		{ id: "ROAD-001", title: "a", status: "backlog", epic_id: "EPIC-001" },
		{ id: "ROAD-002", title: "b", status: "backlog", epic_id: null },
	] satisfies BoardCard[];
	assert.deepEqual(filterByEpic(cards, "none").map((c) => c.id), ["ROAD-002"]);
	assert.deepEqual(filterByEpic(cards, "EPIC-001").map((c) => c.id), ["ROAD-001"]);
	assert.deepEqual(filterByEpic(cards).map((c) => c.id), ["ROAD-001", "ROAD-002"]);
});
