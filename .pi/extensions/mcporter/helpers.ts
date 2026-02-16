import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_SAVED_OUTPUT_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_TEMP_ARTIFACT_DIRS = 30;

export type ErrorType = "aborted" | "timeout" | "exec";

export function clampTimeout(timeoutMs: number | undefined, defaults: { value: number; max: number }): number {
	if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return defaults.value;
	if (timeoutMs < 1_000) return 1_000;
	if (timeoutMs > defaults.max) return defaults.max;
	return Math.floor(timeoutMs);
}

export function stripAtPrefix(value: string): string {
	return value.replace(/^@+/, "");
}

export function isLikelyUrl(value: string): boolean {
	return value.startsWith("https://");
}

export function isValidUrl(value: string): boolean {
	return /^https:\/\/[\w./:%?#@=+,~-]+$/.test(value);
}

function pruneTempArtifacts(tempPrefix: string): void {
	try {
		const root = tmpdir();
		const dirs = readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name.startsWith(tempPrefix))
			.map((entry) => {
				const fullPath = join(root, entry.name);
				const stats = statSync(fullPath);
				return { fullPath, mtimeMs: stats.mtimeMs };
			})
			.sort((a, b) => b.mtimeMs - a.mtimeMs);

		for (const stale of dirs.slice(MAX_TEMP_ARTIFACT_DIRS)) {
			rmSync(stale.fullPath, { recursive: true, force: true });
		}
	} catch {
		// Best-effort cleanup only.
	}
}

function sliceToMaxUtf8Bytes(value: string, maxBytes: number): string {
	let low = 0;
	let high = value.length;
	let best = "";

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = value.slice(0, mid);
		const size = Buffer.byteLength(candidate, "utf8");
		if (size <= maxBytes) {
			best = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return best;
}

export function finalizeOutput(
	output: string,
	tempPrefix: string,
): { text: string; truncated?: boolean; fullOutputPath?: string } {
	const truncation = truncateHead(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	if (!truncation.truncated) {
		return { text: truncation.content };
	}

	let fullOutputPath: string | undefined;
	let writeWarning = "";
	try {
		const tempDir = mkdtempSync(join(tmpdir(), tempPrefix));
		const tempFile = join(tempDir, "output.txt");
		const totalBytes = Buffer.byteLength(output, "utf8");
		let savedOutput = output;

		if (totalBytes > MAX_SAVED_OUTPUT_BYTES) {
			savedOutput = sliceToMaxUtf8Bytes(output, MAX_SAVED_OUTPUT_BYTES);
		}

		writeFileSync(tempFile, savedOutput, "utf8");
		fullOutputPath = tempFile;
		pruneTempArtifacts(tempPrefix);

		const savedBytes = Buffer.byteLength(savedOutput, "utf8");
		if (savedBytes < totalBytes) {
			writeWarning = ` Saved only the first ${formatSize(savedBytes)} of ${formatSize(totalBytes)}.`;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeWarning = ` Could not save full output: ${message}.`;
	}

	let text = truncation.content;
	text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
	text += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
	if (fullOutputPath) {
		text += ` Full output saved to: ${fullOutputPath}.`;
	}
	if (writeWarning) {
		const cappedWarning = writeWarning.length > 400 ? `${writeWarning.slice(0, 400)}...` : writeWarning;
		text += cappedWarning;
	}
	text += "]";

	return {
		text,
		truncated: true,
		fullOutputPath,
	};
}

export function formatCombinedOutput(stdout: string, stderr: string): string {
	const blocks: string[] = [];
	if (stdout.trim().length > 0) {
		blocks.push(stdout.trimEnd());
	}
	if (stderr.trim().length > 0) {
		blocks.push(`stderr:\n${stderr.trimEnd()}`);
	}
	if (blocks.length === 0) return "No output";
	return blocks.join("\n\n");
}

export function classifyExecError(
	error: unknown,
	signal: AbortSignal | undefined,
	messages: {
		cancelled: string;
		timeout: string;
		failedPrefix: string;
	},
): {
	message: string;
	errorType: ErrorType;
	exitCode: number;
	userMessage: string;
} {
	const message = error instanceof Error ? error.message : String(error);
	const errorCode =
		typeof error === "object" && error !== null && "code" in error
			? String((error as { code?: unknown }).code ?? "").toLowerCase()
			: "";
	if (errorCode.includes("timeout") || errorCode === "etimedout") {
		return {
			message,
			errorType: "timeout",
			exitCode: 124,
			userMessage: messages.timeout,
		};
	}

	const lower = message.toLowerCase();
	if (lower.includes("timed out") || lower.includes("timeout")) {
		return {
			message,
			errorType: "timeout",
			exitCode: 124,
			userMessage: messages.timeout,
		};
	}

	if (signal?.aborted) {
		return {
			message,
			errorType: "aborted",
			exitCode: 130,
			userMessage: messages.cancelled,
		};
	}

	return {
		message,
		errorType: "exec",
		exitCode: 1,
		userMessage: `${messages.failedPrefix}: ${message}`,
	};
}
