import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
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
	/\bcurl\s+\S*\s*\|\s*\S/i,
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
	/^\s*git\s+(status|log|show|branch|remote|config\s+--get)\b/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
	/^\s*yarn\s+(list|info|why|audit)\b/i,
	/^\s*node\s+--version\b/i,
	/^\s*python\s+--version\b/i,
	/^\s*cat\b/i,
	/^\s*jq\b/i,
	/^\s*sed\s+-n\b/i,
	/^\s*awk\b/i,
	/^\s*rg\b/i,
	/^\s*fd\b/i,
	/^\s*bat\b/i,
	/^\s*exa\b/i,
	/^\s*cd\b/i,
	/^\s*npm\s+search\b/i,
];

const ASSIGNMENT_PREFIX_PATTERN = /^((?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]+))\s+/;
const MAX_TITLE_SLUG_LENGTH = 100;

function splitCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;
	let escaped = false;

	function flushSegment(): void {
		const segment = current.trim();
		if (segment.length > 0) {
			segments.push(segment);
		}
		current = "";
	}

	for (let index = 0; index < command.length; index++) {
		const char = command[index]!;

		if (escaped) {
			escaped = false;
			current += char;
			continue;
		}

		if (char === "\\" && !inSingle) {
			escaped = true;
			current += char;
			continue;
		}

		if (char === "'" && !inDouble) {
			inSingle = !inSingle;
			current += char;
			continue;
		}

		if (char === '"' && !inSingle) {
			inDouble = !inDouble;
			current += char;
			continue;
		}

		if (!inSingle && !inDouble) {
			const remaining = command.slice(index);
			if (remaining.startsWith("&&") || remaining.startsWith("||") || char === "|" || char === ";" || char === "\n" || char === "&") {
				flushSegment();
				if (remaining.startsWith("&&") || remaining.startsWith("||")) {
					index += 1;
				}
				continue;
			}
		}

		current += char;
	}

	flushSegment();
	return segments;
}

function normalizeCommandSegment(segment: string): string {
	let normalized = segment.trim();
	if (normalized.length === 0) {
		return "";
	}

	normalized = normalized.replace(/^!\s*/, "");
	while (ASSIGNMENT_PREFIX_PATTERN.test(normalized)) {
		normalized = normalized.replace(ASSIGNMENT_PREFIX_PATTERN, "").trim();
	}

	while (normalized.startsWith("(") && normalized.endsWith(")")) {
		normalized = normalized.slice(1, -1).trim();
	}

	return normalized;
}

function isSegmentReadOnly(command: string): boolean {
	const normalized = normalizeCommandSegment(command);
	if (!normalized) return false;
	const lower = normalized.toLowerCase();
	if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(lower))) return false;
	if (!SAFE_PATTERNS.some((pattern) => pattern.test(lower))) return false;
	return true;
}

export function isSafeReadOnlyBashCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) return false;

	const segments = splitCommandSegments(trimmed);
	if (segments.length === 0) return false;
	return segments.every(isSegmentReadOnly);
}

function cleanStepText(text: string): string {
	const cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[[^\]]+\]\([^\)]+\)/g, (match) => match.replace(/^\[(.*?)\]\(.*\)$/, "$1"))
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned) return cleaned;
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

interface ParsedPlanStep {
	step?: number;
	text: string;
}

function parseStepLine(line: string): ParsedPlanStep | undefined {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return;

	const numberedMatch = trimmed.match(/^[-*]?\s*\d+\.?\)?\s+(.+)$/);
	if (numberedMatch && /^(?:-\*\s*)?\d+[.)]/.test(trimmed)) {
		const split = trimmed.match(/^(?:[-*]\s*)?(\d+)\.?\)?\s+(.+)$/);
		if (split) {
			const step = Number(split[1]);
			if (!Number.isFinite(step) || step <= 0) return;
			const text = cleanStepText(split[2]);
			if (!text) return;
			return { step, text };
		}
	}

	const checkboxMatch = trimmed.match(/^[-*]\s*\[[xX\s]\]\s+(?:\d+[.)]\s+)?(.+)$/);
	if (checkboxMatch) {
		const rest = checkboxMatch[1];
		if (!rest) return;
		const split = rest.match(/^(\d+)\.?\)?\s+(.+)$/);
		if (split) {
			const step = Number(split[1]);
			if (!Number.isFinite(step) || step <= 0) return;
			const text = cleanStepText(split[2]);
			if (!text) return;
			return { step, text };
		}
		const text = cleanStepText(rest);
		if (!text) return;
		return { text };
	}

	const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
	if (bulletMatch) {
		const text = cleanStepText(bulletMatch[1]);
		if (!text) return;
		return { text };
	}

	return;
}

function parsePlanStepsFromText(text: string): PlanStep[] {
	const lines = text.split(/\r?\n/);
	const parsed: ParsedPlanStep[] = [];
	for (const line of lines) {
		const step = parseStepLine(line);
		if (step) {
			parsed.push(step);
		}
	}

	const seen = new Set<number>();
	const out: PlanStep[] = [];
	let nextStep = 1;

	for (const step of parsed) {
		const stepNumber = step.step === undefined ? nextStep : step.step;
		if (!Number.isInteger(stepNumber) || stepNumber <= 0) {
			continue;
		}

		if (seen.has(stepNumber)) {
			continue;
		}

		out.push({ step: stepNumber, text: step.text, completed: false });
		seen.add(stepNumber);
		nextStep = Math.max(nextStep, stepNumber + 1);
	}

	return out;
}

function extractStepSection(markdown: string): string | undefined {
	const match = markdown.match(/(?:^|\n)#{1,6}\s*Steps\b[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s+[^\n]+\n|$)/i);
	if (!match || match[1] === undefined) return undefined;
	return match[1];
}

export function extractPlanSteps(markdown: string): PlanStep[] {
	const section = extractStepSection(markdown);
	if (section) {
		const sectionSteps = parsePlanStepsFromText(section);
		if (sectionSteps.length > 0) return sectionSteps;
	}

	const allSteps = parsePlanStepsFromText(markdown);
	return allSteps;
}

export function extractDoneSteps(messageText: string): number[] {
	const steps = new Set<number>();
	for (const match of messageText.matchAll(/\[\s*DONE\s*:\s*(\d+)\s*\]/gi)) {
		const parsed = Number(match[1]);
		if (Number.isFinite(parsed)) steps.add(parsed);
	}
	return [...steps];
}

export function markCompletedSteps(messageText: string, steps: PlanStep[]): number {
	const done = extractDoneSteps(messageText);
	let changed = 0;

	for (const stepNumber of done) {
		const target = steps.find((step) => step.step === stepNumber && !step.completed);
		if (target) {
			target.completed = true;
			changed += 1;
		}
	}
	return changed;
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
		.replace(/^-+|-+$/g, "")
		.slice(0, MAX_TITLE_SLUG_LENGTH) || "plan";

	return `${yyyy}-${mm}-${dd}-${hh}-${min}-${slug}.md`;
}

function toSessionId(sessionFile?: string): string | undefined {
	if (!sessionFile) return undefined;
	const file = basename(sessionFile);
	return file.slice(0, file.length - extname(file).length);
}

function escapeYamlString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\"');
}

async function resolvePlanFilename(plansDir: string, base: string): Promise<string> {
	const stem = base.replace(/\.md$/i, "");
	let attempt = 0;
	let current = `${stem}.md`;
	for (;;) {
		try {
			await access(join(plansDir, current), constants.F_OK);
			attempt += 1;
			current = `${stem}-${attempt}.md`;
		} catch {
			return current;
		}
	}
}

export async function saveApprovedPlan(input: SaveApprovedPlanInput): Promise<SaveApprovedPlanResult> {
	const plansDir = join(input.cwd, "docs", "plans");
	await mkdir(plansDir, { recursive: true });

	const requestedFilename = toPlanFilename(input.title);
	const filename = await resolvePlanFilename(plansDir, requestedFilename);
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
