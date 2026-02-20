import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

import type { PlanStep, SaveApprovedPlanInput, SaveApprovedPlanResult } from "./types.js";

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)\b/i,
	/\byarn\s+(add|remove|install|publish)\b/i,
	/\bpnpm\s+(add|remove|install|publish)\b/i,
	/\bpip\s+(install|uninstall)\b/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)\b/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill(all)?\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
	/\bservice\s+\S+\s+(start|stop|restart)\b/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
	/^\s*cat\b/i,
	/^\s*head\b/i,
	/^\s*tail\b/i,
	/^\s*less\b/i,
	/^\s*more\b/i,
	/^\s*grep\b/i,
	/^\s*find\b/i,
	/^\s*ls\b/i,
	/^\s*pwd\b/i,
	/^\s*echo\b/i,
	/^\s*printf\b/i,
	/^\s*wc\b/i,
	/^\s*sort\b/i,
	/^\s*uniq\b/i,
	/^\s*diff\b/i,
	/^\s*file\b/i,
	/^\s*stat\b/i,
	/^\s*du\b/i,
	/^\s*df\b/i,
	/^\s*tree\b/i,
	/^\s*which\b/i,
	/^\s*whereis\b/i,
	/^\s*type\b/i,
	/^\s*env\b/i,
	/^\s*printenv\b/i,
	/^\s*uname\b/i,
	/^\s*whoami\b/i,
	/^\s*id\b/i,
	/^\s*date\b/i,
	/^\s*uptime\b/i,
	/^\s*ps\b/i,
	/^\s*top\b/i,
	/^\s*htop\b/i,
	/^\s*free\b/i,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)\b/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*yarn\s+(list|info|why|audit)\b/i,
	/^\s*node\s+--version\b/i,
	/^\s*python\s+--version\b/i,
	/^\s*curl\b/i,
	/^\s*wget\s+-O\s*-\b/i,
	/^\s*jq\b/i,
	/^\s*sed\s+-n\b/i,
	/^\s*awk\b/i,
	/^\s*rg\b/i,
	/^\s*fd\b/i,
	/^\s*bat\b/i,
	/^\s*exa\b/i,
];

export function isSafeReadOnlyBashCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
	const isSafe = SAFE_PATTERNS.some((pattern) => pattern.test(command));
	return !isDestructive && isSafe;
}

function cleanStepText(text: string): string {
	const cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[[^\]]+\]\([^\)]+\)/g, (match) => match.replace(/\[(.*)\]\(.*\)/, "$1"))
		.replace(/\s+/g, " ")
		.trim();

	if (!cleaned) return cleaned;
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractNumberedLines(text: string): PlanStep[] {
	const steps: PlanStep[] = [];
	const numberedPattern = /^\s*(\d+)[.)]\s+(.+)$/gm;

	for (const match of text.matchAll(numberedPattern)) {
		const number = Number(match[1]);
		const raw = match[2]?.trim() ?? "";
		const stepText = cleanStepText(raw);
		if (!Number.isFinite(number) || !stepText) continue;
		steps.push({ step: number, text: stepText, completed: false });
	}

	return steps;
}

export function extractPlanSteps(markdown: string): PlanStep[] {
	const stepsHeader = markdown.match(/(?:^|\n)#{1,6}\s*Steps\s*\n([\s\S]*?)(?:\n#{1,6}\s+[^\n]+\n|$)/i);
	if (stepsHeader && stepsHeader[1]) {
		const sectionSteps = extractNumberedLines(stepsHeader[1]);
		if (sectionSteps.length > 0) return sectionSteps;
	}

	const allSteps = extractNumberedLines(markdown);
	if (allSteps.length === 0) return [];

	const deduped: PlanStep[] = [];
	const seen = new Set<number>();
	for (const step of allSteps) {
		if (seen.has(step.step)) continue;
		seen.add(step.step);
		deduped.push(step);
	}
	return deduped;
}

export function extractDoneSteps(messageText: string): number[] {
	const steps: number[] = [];
	for (const match of messageText.matchAll(/\[DONE:(\d+)\]/gi)) {
		const parsed = Number(match[1]);
		if (Number.isFinite(parsed)) steps.push(parsed);
	}
	return steps;
}

export function markCompletedSteps(messageText: string, steps: PlanStep[]): number {
	const done = extractDoneSteps(messageText);
	for (const stepNumber of done) {
		const target = steps.find((step) => step.step === stepNumber);
		if (target) target.completed = true;
	}
	return done.length;
}

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

export function toPlanFilename(title: string, now: Date = new Date()): string {
	const yyyy = now.getFullYear();
	const mm = pad2(now.getMonth() + 1);
	const dd = pad2(now.getDate());
	const hh = pad2(now.getHours());
	const min = pad2(now.getMinutes());

	const slug = title
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "") || "plan";

	return `${yyyy}-${mm}-${dd}-${hh}-${min}-${slug}.md`;
}

function toSessionId(sessionFile?: string): string | undefined {
	if (!sessionFile) return undefined;
	const file = basename(sessionFile);
	return file.slice(0, file.length - extname(file).length);
}

function escapeYamlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function saveApprovedPlan(input: SaveApprovedPlanInput): Promise<SaveApprovedPlanResult> {
	const plansDir = join(input.cwd, "docs", "plans");
	await mkdir(plansDir, { recursive: true });

	const filename = toPlanFilename(input.title);
	const fullPath = join(plansDir, filename);
	const sessionId = toSessionId(input.sessionFile);
	const iso = new Date().toISOString();

	const frontmatter = [
		"---",
		`title: \"${escapeYamlString(input.title)}\"`,
		"status: approved",
		`decision: ${input.decision}`,
		`approvedAt: ${iso}`,
		sessionId ? `sessionId: ${sessionId}` : undefined,
		input.sessionFile ? `sessionFile: \"${escapeYamlString(input.sessionFile)}\"` : undefined,
		"---",
	]
		.filter((line): line is string => Boolean(line))
		.join("\n");

	const body = `${frontmatter}\n\n# ${input.title}\n\n${input.markdown.trim()}\n`;
	await writeFile(fullPath, body, "utf8");

	return {
		path: fullPath,
		relativePath: relative(input.cwd, fullPath),
		filename,
	};
}
