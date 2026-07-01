import type { Theme } from "@earendil-works/pi-coding-agent";
import { checkLabel, type DisplayCheck, type StepStatus, type WorkflowStep } from "./core.ts";
import type { ProductionizeState, WorkflowOutcome } from "./types.ts";

export class ProductionizePanel {
	private cachedWidth?: number;
	private cachedSignature?: string;
	private cachedLines?: string[];
	private readonly state: ProductionizeState;
	private readonly theme: Theme;
	private readonly done: (result: { action: "close" | "handoff" }) => void;
	private readonly abort: () => void;

	constructor(
		state: ProductionizeState,
		theme: Theme,
		done: (result: { action: "close" | "handoff" }) => void,
		abort: () => void,
	) {
		this.state = state;
		this.theme = theme;
		this.done = done;
		this.abort = abort;
	}

	handleInput(data: string): void {
		if (this.state.outcome === "running") {
			if (matchesKey(data, "escape") || data === "q" || data === "Q") {
				this.state.cancelRequested = true;
				this.state.status = "Cancelling productionize...";
				this.abort();
				this.invalidate();
			}
			return;
		}


		if (this.state.outcome === "failed" && this.state.failure && (data === "f" || data === "F")) {
			this.done({ action: "handoff" });
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "enter") || data === "q" || data === "Q") {
			this.done({ action: "close" });
		}
	}

	render(width: number): string[] {
		const signature = JSON.stringify({
			steps: this.state.steps,
			checks: this.state.checks,
			outcome: this.state.outcome,
			status: this.state.status,
			branch: this.state.branch,
			returnToBranch: this.state.returnToBranch,
			pr: this.state.pr?.url,
			failure: this.state.failure,
			cancel: this.state.cancelRequested,
			auto: this.state.auto,
			log: this.state.log.slice(-8),
		});
		if (this.cachedLines && this.cachedWidth === width && this.cachedSignature === signature) return this.cachedLines;

		const th = this.theme;
		const lines: string[] = [];
		const add = (line = "") => lines.push(truncateToWidth(line, width));
		const border = th.fg("borderMuted", "─".repeat(Math.max(0, width)));

		add(border);
		add(`${th.fg("accent", th.bold("Productionize"))} ${th.fg("muted", "branch → commit → push → PR → CI → merge → return")}${this.state.auto.enabled ? th.fg("warning", "  [auto]") : ""}`);
		add(this.renderProgress(width));
		add(th.fg(statusColor(this.state.outcome), this.state.status));
		if (this.state.branch) add(`${th.fg("muted", "Branch:")} ${this.state.branch}`);
		if (this.state.returnToBranch) add(`${th.fg("muted", "Will return to:")} ${this.state.returnToBranch}`);
		if (this.state.pr) add(`${th.fg("muted", "PR:")} #${this.state.pr.number} ${this.state.pr.url}`);
		add("");

		for (const step of this.state.steps) {
			add(this.renderStep(step));
		}
		add("");

		if (this.state.checks.length > 0) {
			add(th.fg("accent", th.bold("CI checks")));
			for (const check of this.state.checks) add(this.renderCheck(check));
			add("");
		}

		if (this.state.failure) {
			this.renderFailure(add);
		} else if (this.state.outcome === "succeeded") {
			add(th.fg("success", th.bold("Merged successfully.")));
			add(th.fg("dim", "Press Enter or Escape to close."));
		} else if (this.state.outcome === "cancelled") {
			add(th.fg("warning", th.bold("Cancelled.")));
			add(th.fg("dim", "Press Enter or Escape to close."));
		} else {
			add(th.fg("dim", "Esc cancels outstanding work where possible."));
		}

		if (this.state.log.length > 0) {
			add("");
			add(th.fg("accent", th.bold("Recent log")));
			for (const line of this.state.log.slice(-8)) add(th.fg("dim", `• ${line}`));
		}
		add(border);

		this.cachedWidth = width;
		this.cachedSignature = signature;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedSignature = undefined;
		this.cachedLines = undefined;
	}

	private renderProgress(width: number): string {
		const done = this.state.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
		const total = this.state.steps.length;
		const barWidth = Math.max(10, Math.min(40, width - 20));
		const filled = Math.round((done / total) * barWidth);
		const bar = `${"█".repeat(filled)}${"░".repeat(barWidth - filled)}`;
		return `${this.theme.fg("success", bar)} ${done}/${total}`;
	}

	private renderStep(step: WorkflowStep): string {
		const icon = statusIcon(step.status);
		const color = step.status === "failed" ? "error" : step.status === "done" ? "success" : step.status === "running" ? "accent" : "dim";
		const detail = step.detail ? this.theme.fg("muted", ` — ${step.detail}`) : "";
		return `${this.theme.fg(color, `${icon} ${step.label}`)}${detail}`;
	}

	private renderCheck(check: DisplayCheck): string {
		const color = check.status === "failed" ? "error" : check.status === "passed" ? "success" : check.status === "skipped" ? "dim" : "warning";
		const icon = check.status === "failed" ? "✗" : check.status === "passed" ? "✓" : check.status === "skipped" ? "-" : "□";
		const label = checkLabel(check);
		const link = check.link ? this.theme.fg("dim", ` ${check.link}`) : "";
		return `${this.theme.fg(color, `${icon} ${label}`)}${link}`;
	}

	private renderFailure(add: (line?: string) => void): void {
		const failure = this.state.failure;
		if (!failure) return;
		add(this.theme.fg("error", this.theme.bold("Failure")));
		add(`Step: ${failure.step}`);
		if (failure.command) add(`Command: ${[failure.command, ...(failure.args ?? [])].join(" ")}`);
		if (failure.code !== undefined) add(`Exit code: ${failure.code}`);
		if (failure.message) add(`Error: ${failure.message}`);
		add("");
		add(this.theme.fg("dim", "Press F to ask the model to fix this in-band."));
		add(this.theme.fg("dim", "Press Enter or Escape to close."));
	}
}

function statusIcon(status: StepStatus): string {
	switch (status) {
		case "done":
			return "✓";
		case "failed":
			return "✗";
		case "running":
			return "▶";
		case "skipped":
			return "-";
		case "cancelled":
			return "!";
		default:
			return "□";
	}
}

function statusColor(outcome: WorkflowOutcome): "success" | "error" | "warning" | "accent" {
	switch (outcome) {
		case "succeeded":
			return "success";
		case "failed":
			return "error";
		case "cancelled":
			return "warning";
		default:
			return "accent";
	}
}

function matchesKey(data: string, key: "escape" | "enter"): boolean {
	if (key === "escape") return data === "\u001B" || data === "\x1B" || data === "\u001B\u001B";
	return data === "\r" || data === "\n" || data === "\r\n";
}

function truncateToWidth(line: string, width: number): string {
	if (width <= 0) return "";
	let visible = 0;
	let index = 0;
	let sawAnsi = false;
	while (index < line.length && visible < width) {
		const ansi = /^\x1B\[[0-?]*[ -/]*[@-~]/.exec(line.slice(index));
		if (ansi) {
			sawAnsi = true;
			index += ansi[0].length;
			continue;
		}
		const codePoint = line.codePointAt(index);
		if (codePoint === undefined) break;
		visible += isWideCodePoint(codePoint) ? 2 : 1;
		if (visible > width) break;
		index += codePoint > 0xffff ? 2 : 1;
	}
	if (index >= line.length) return line;
	return `${line.slice(0, index)}${sawAnsi ? "\x1B[0m" : ""}`;
}

function isWideCodePoint(codePoint: number): boolean {
	return (
		(codePoint >= 0x1100 && codePoint <= 0x115f) ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
		(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6)
	);
}
