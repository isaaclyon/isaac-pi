/**
 * Roadmap extension — the human's always-on surface for the project board.
 *
 * On session start (in a repo that owns `.pi/roadmap/roadmap.sqlite`) it ensures a
 * single read-only UI server is running for the project, prints the live URL with a
 * compact summary, and paints an aboveEditor widget. It registers `/road …` commands
 * as thin wrappers over the board's validating `cli.js`. The skill remains the agent's
 * programmatic interface; this is the human's runtime presence. Both share `cli.js`,
 * so no board logic is duplicated here.
 */

import { existsSync, realpathSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	type ActivityEventInput,
	type BoardCard,
	type BoardSnapshot,
	buildActivityLines,
	buildBoardSummary,
	buildNotifyLine,
	buildWidgetLines,
	countReady,
	fillTemplate,
	hasBoard,
	resolveProjectRoot,
	shapeActivity,
} from "./core.ts";
import { detachServer, ensureServer, fetchSnapshot, fetchTimeline, postActivity, resolveCliPath } from "./server.ts";

const WIDGET_KEY = "roadmap";
const CLI_TIMEOUT_MS = 15_000;
const STAGES = ["brainstorm", "plan", "execute", "review"] as const;
type Stage = (typeof STAGES)[number];

interface Attached {
	root: string;
	cliPath: string;
	port: number;
}

export default function roadmapExtension(pi: ExtensionAPI) {
	let attached: Attached | undefined;
	let sessionId: string | undefined;

	// --- live activity capture (ROAD-025) ---------------------------------

	/**
	 * Shape a captured Pi lifecycle event and fire-and-forget POST it to the board server.
	 * No-op until a server is attached and the session id is known. Deliberately NOT awaited
	 * and never throwing — this runs on the agent's hot path (every tool call), so a slow or
	 * down board must never slow or break the agent. The server attributes the event to the
	 * card this session claims, so we send no card context here.
	 */
	function report(event: ActivityEventInput): void {
		if (!attached || !sessionId) return;
		const shaped = shapeActivity(event);
		if (!shaped) return;
		void postActivity(attached.port, { session: sessionId, ...shaped });
	}

	pi.on("agent_start", () => report({ type: "agent_start" }));
	pi.on("agent_end", () => report({ type: "agent_end" }));
	pi.on("tool_execution_start", (e) => report({ type: "tool_execution_start", toolName: e.toolName, args: e.args }));
	pi.on("tool_execution_end", (e) => report({ type: "tool_execution_end", toolName: e.toolName, isError: e.isError }));
	pi.on("model_select", (e) => report({ type: "model_select", modelName: e.model?.name ?? e.model?.id }));

	// --- helpers ----------------------------------------------------------

	async function gitCommonDir(cwd: string): Promise<string | null> {
		const result = await pi.exec("git", ["rev-parse", "--git-common-dir"], { cwd, timeout: 5_000 });
		if (result.code !== 0) return null;
		const out = result.stdout.trim();
		return out ? out : null;
	}

	/** Resolve the project root + cli for `cwd`, returning null when there's no board. */
	async function resolve(cwd: string): Promise<{ root: string; cliPath: string } | null> {
		const root = resolveProjectRoot({
			cwd,
			env: process.env,
			fileExists: existsSync,
			realpath: realpathSync,
			gitCommonDir: await gitCommonDir(cwd),
		});
		if (!hasBoard(root, existsSync)) return null;
		const cliPath = resolveCliPath(cwd);
		if (!cliPath) return null;
		return { root, cliPath };
	}

	async function runCli(root: string, cliPath: string, args: string[]): Promise<unknown> {
		const result = await pi.exec("node", ["--no-warnings", cliPath, ...args], { cwd: root, timeout: CLI_TIMEOUT_MS });
		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || `cli ${args[0]} exited ${result.code}`);
		}
		return JSON.parse(result.stdout);
	}

	/** A fresh snapshot via the validating CLI (independent of the running server). */
	async function snapshot(target: { root: string; cliPath: string }): Promise<BoardSnapshot> {
		return (await runCli(target.root, target.cliPath, ["list"])) as BoardSnapshot;
	}

	function slim(card: BoardCard): string {
		return `${card.id}  ${card.status.padEnd(11)}  ${card.title}${card.epic_id ? `  [${card.epic_id}]` : ""}`;
	}

	function parseEpicFlag(tokens: string[]): string | undefined {
		const i = tokens.indexOf("--epic");
		return i >= 0 ? tokens[i + 1] : undefined;
	}

	function refreshWidget(ctx: ExtensionCommandContext, snap: BoardSnapshot): void {
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, buildWidgetLines(snap), { placement: "aboveEditor" });
	}

	// --- session lifecycle ------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		const target = await resolve(ctx.cwd);
		if (!target) {
			// Board-less repo: a single non-intrusive hint, no server, no widget.
			ctx.ui.notify("📋 No roadmap board here. Run `/road init` to create one.", "info");
			return;
		}

		sessionId = sessionIdFor(ctx);
		try {
			const result = await ensureServer(target.root, target.cliPath, sessionId);
			attached = { root: target.root, cliPath: target.cliPath, port: result.port };
			const snap = result.snapshot ?? (await snapshot(target));
			ctx.ui.notify(buildNotifyLine(result.url, snap), "info");
			refreshWidget(ctx, snap);
			report({ type: "session_start" });
		} catch (error) {
			ctx.ui.notify(`Roadmap: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});

	pi.on("session_shutdown", async () => {
		if (attached && sessionId) {
			// Post the session-ended marker first (awaited here, unlike the hot-path reports) so it
			// lands in the ring while the server is still up — detachServer may kill it next if we're
			// the last ref.
			try {
				await postActivity(attached.port, { session: sessionId, kind: "session_shutdown", title: "Session ended", status: "info" });
			} catch {
				/* best-effort marker */
			}
			// Drop this session's active claims so a clean exit doesn't leave cards looking owned by a
			// gone session. Best-effort: a crash skips this, and stale claims stay visible (with their
			// age) for a human or a force-claim to clear.
			try {
				await releaseSessionClaims(attached, sessionId);
			} catch {
				/* best-effort claim cleanup */
			}
			try {
				await detachServer(attached.root, sessionId);
			} catch {
				/* best-effort teardown */
			}
		}
		attached = undefined;
	});

	/** Release every card currently claimed by `owner` (this session) via the validating CLI. */
	async function releaseSessionClaims(target: { root: string; cliPath: string }, owner: string): Promise<void> {
		const snap = await snapshot(target);
		const mine = snap.cards.filter((c) => c.claimed_by === owner);
		for (const card of mine) {
			await runCli(target.root, target.cliPath, ["release", card.id, owner]);
		}
	}

	// --- /road command ----------------------------------------------------

	pi.registerCommand("road", {
		description:
			"Roadmap board. Usage: /road [summary] | ready [--epic E] | get <id> | blocked | activity [id] | claim|release <id> | open | init | triage|new <idea> | brainstorm|plan|execute|review <id>",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const tokens = trimmed.split(/\s+/).filter(Boolean);
			const sub = (tokens.shift() ?? "summary").toLowerCase();
			// Raw remainder after the subcommand word, with the user's spacing preserved
			// (token-splitting collapses whitespace, which matters for free-text ideas).
			const rest = trimmed.slice(sub.length).trim();

			// `init` bootstraps a board in cwd and needs no existing one.
			if (sub === "init") {
				const cliPath = resolveCliPath(ctx.cwd);
				if (!cliPath) {
					ctx.ui.notify("Roadmap: could not locate cli.js (set ROADMAP_CLI).", "error");
					return;
				}
				try {
					await runCli(ctx.cwd, cliPath, ["init"]);
					ctx.ui.notify("📋 Roadmap initialized. Run `/reload` so the extension picks it up.", "info");
				} catch (error) {
					ctx.ui.notify(`Roadmap init failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}

			const target = attached ?? (await resolve(ctx.cwd));
			if (!target) {
				ctx.ui.notify("📋 No roadmap board here. Run `/road init` to create one.", "warning");
				return;
			}

			try {
				if (sub === "open") {
					sessionId = sessionId ?? sessionIdFor(ctx);
					const result = await ensureServer(target.root, target.cliPath, sessionId);
					attached = { root: target.root, cliPath: target.cliPath, port: result.port };
					ctx.ui.notify(`📋 Roadmap → ${result.url}`, "info");
					return;
				}

				if (sub === "summary") {
					const snap = await snapshot(target);
					refreshWidget(ctx, snap);
					ctx.ui.notify(buildBoardSummary(snap), "info");
					return;
				}

				if (sub === "ready") {
					const epic = parseEpicFlag(tokens);
					let cards = (await runCli(target.root, target.cliPath, ["ready"])) as BoardCard[];
					if (epic === "none") cards = cards.filter((c) => !c.epic_id);
					else if (epic) cards = cards.filter((c) => c.epic_id === epic);
					ctx.ui.notify(cards.length ? cards.map(slim).join("\n") : "No ready cards.", "info");
					return;
				}

				if (sub === "blocked") {
					const cards = (await runCli(target.root, target.cliPath, ["blocked-deps"])) as BoardCard[];
					ctx.ui.notify(cards.length ? cards.map(slim).join("\n") : "No dependency-blocked cards.", "info");
					return;
				}

				if (sub === "activity") {
					// The live half lives in the server's RAM, so this read needs a running server —
					// ensure one (like `open`) rather than going through the CLI. `<id>` scopes to a card.
					sessionId = sessionId ?? sessionIdFor(ctx);
					const ensured = await ensureServer(target.root, target.cliPath, sessionId);
					attached = { root: target.root, cliPath: target.cliPath, port: ensured.port };
					const card = tokens.find((t) => !t.startsWith("--"));
					const timeline = await fetchTimeline(ensured.port, { limit: 20, card });
					if (!timeline) {
						ctx.ui.notify("Roadmap: could not read the activity timeline from the server.", "warning");
						return;
					}
					ctx.ui.notify(buildActivityLines(timeline.items, Date.now()).join("\n"), "info");
					return;
				}

				if (sub === "claim" || sub === "release") {
					const id = tokens.find((t) => t !== "--force");
					if (!id) {
						ctx.ui.notify(`Usage: /road ${sub} <id> [--force]`, "warning");
						return;
					}
					// The live Pi session is the claim owner, so a session can only release its own
					// claim (the model rejects a mismatched owner) unless --force is passed.
					sessionId = sessionId ?? sessionIdFor(ctx);
					const force = tokens.includes("--force");
					const cliArgs = [sub, id, sessionId, ...(force ? ["--force"] : [])];
					const card = (await runCli(target.root, target.cliPath, cliArgs)) as BoardCard;
					ctx.ui.notify(
						sub === "claim" ? `🔒 Claimed ${card.id} — ${card.title}` : `🔓 Released ${card.id}`,
						"info",
					);
					return;
				}

				if (sub === "get") {
					const id = tokens[0];
					if (!id) {
						ctx.ui.notify("Usage: /road get <id>", "warning");
						return;
					}
					const snap = await snapshot(target);
					const card = snap.cards.find((c) => c.id === id);
					if (!card) {
						ctx.ui.notify(`Unknown card: ${id}`, "warning");
						return;
					}
					const events = (await runCli(target.root, target.cliPath, ["events", id])) as Array<{
						event_type: string;
						actor_type: string;
						created_at: string;
					}>;
					const lines = [
						`${card.id}  [${card.status}]${card.epic_id ? `  ${card.epic_id}` : ""}`,
						card.title,
						"",
						"History:",
						...events.slice(0, 12).map((e) => `  ${e.created_at}  ${e.actor_type}/${e.event_type}`),
					];
					ctx.ui.notify(lines.join("\n"), "info");
					return;
				}

				if (sub === "triage" || sub === "new") {
					await handleTriage(ctx, target, rest);
					return;
				}

				if ((STAGES as readonly string[]).includes(sub)) {
					await handleStage(ctx, target, sub as Stage, tokens[0]);
					return;
				}

				ctx.ui.notify(
					`Unknown subcommand: ${sub}. Try /road, ready, get <id>, blocked, activity, open, triage <idea>, ${STAGES.join("|")}.`,
					"warning",
				);
			} catch (error) {
				ctx.ui.notify(`Roadmap: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	/**
	 * Fill the board's prompt-action template for `<stage> <id>` and hand it to the
	 * current agent. The card is NOT moved — status transitions stay explicit/opt-in.
	 */
	async function handleStage(
		ctx: ExtensionCommandContext,
		target: { root: string; cliPath: string },
		stage: Stage,
		id: string | undefined,
	): Promise<void> {
		if (!id) {
			ctx.ui.notify(`Usage: /road ${stage} <id>`, "warning");
			return;
		}
		const snap = await snapshot(target);
		const card = snap.cards.find((c) => c.id === id);
		if (!card) {
			ctx.ui.notify(`Unknown card: ${id}`, "warning");
			return;
		}
		const template = snap.prompts?.[stage];
		if (!template) {
			ctx.ui.notify(`No "${stage}" prompt template configured for this board.`, "warning");
			return;
		}
		const filled = fillTemplate(template, { id: card.id, title: card.title });
		pi.sendUserMessage(filled);
	}

	/**
	 * Hand a free-text idea to the current agent to capture as a Triage card. This is
	 * a prompt handoff, not a direct write — the agent creates the card through the
	 * roadmap-board skill (the validating path). An optional `prompts.triage` template
	 * (with an `{{idea}}` placeholder) overrides the built-in default.
	 */
	async function handleTriage(
		ctx: ExtensionCommandContext,
		target: { root: string; cliPath: string },
		idea: string,
	): Promise<void> {
		if (!idea) {
			ctx.ui.notify("Usage: /road triage <idea>  (alias: /road new)", "warning");
			return;
		}
		const snap = await snapshot(target);
		const template =
			snap.prompts?.triage ??
			"Capture this new roadmap idea as a Triage card: {{idea}}\n\n" +
				"Using the roadmap-board skill, refine it into a clear title and a short summary, " +
				"create the Triage card, and report the new card id. Do not plan or implement it yet.";
		pi.sendUserMessage(fillTemplate(template, { idea }));
	}
}

/** A stable per-session id for the refset. */
function sessionIdFor(ctx: { sessionManager: { getSessionId: () => string } }): string {
	return ctx.sessionManager.getSessionId();
}
