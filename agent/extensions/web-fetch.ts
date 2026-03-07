/**
 * Web Fetch Tool - Fetches content from URLs
 *
 * Supports optional readability extraction and markdown conversion for HTML pages.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const OUTPUT_FORMATS = ["raw", "readable", "markdown"] as const;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 120_000;

type HttpMethod = (typeof HTTP_METHODS)[number];
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

const FetchParams = Type.Object({
	url: Type.String({ description: "URL to fetch" }),
	method: Type.Optional(
		StringEnum(HTTP_METHODS, {
			description: "HTTP method (default: GET)",
		}),
	),
	headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "HTTP headers as key-value pairs" })),
	body: Type.Optional(Type.String({ description: "Request body (for POST, PUT, PATCH, DELETE)" })),
	format: Type.Optional(
		StringEnum(OUTPUT_FORMATS, {
			description: "Output format. raw = full response text, readable = cleaned text for HTML, markdown = markdown for HTML",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
			minimum: 1_000,
			maximum: MAX_TIMEOUT_MS,
		}),
	),
});

interface FetchArgs {
	url: string;
	method?: HttpMethod;
	headers?: Record<string, string>;
	body?: string;
	format?: OutputFormat;
	timeoutMs?: number;
}

interface FetchDetails {
	url: string;
	method: HttpMethod;
	status?: number;
	statusText?: string;
	contentType?: string;
	requestedFormat: OutputFormat;
	appliedFormat: OutputFormat;
	timeoutMs: number;
	truncated?: boolean;
	fullOutputPath?: string;
	error?: string;
}

function clampTimeout(timeoutMs: number | undefined): number {
	if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
	if (timeoutMs < 1_000) return 1_000;
	if (timeoutMs > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
	return Math.floor(timeoutMs);
}

function validateUrl(url: string): { ok: true } | { ok: false; message: string } {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { ok: false, message: "Invalid URL" };
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			ok: false,
			message: `Unsupported URL protocol: ${parsed.protocol}. Only http:// and https:// are allowed.`,
		};
	}

	return { ok: true };
}

function supportsRequestBody(method: HttpMethod): boolean {
	return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function isHtmlResponse(contentType: string | undefined, text: string): boolean {
	const normalizedContentType = (contentType ?? "").toLowerCase();
	if (normalizedContentType.includes("text/html") || normalizedContentType.includes("application/xhtml+xml")) {
		return true;
	}

	const start = text.slice(0, 600).toLowerCase();
	return start.includes("<!doctype html") || start.includes("<html") || start.includes("<body");
}

function decodeHtmlEntities(value: string): string {
	const namedEntities: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		ndash: "-",
		mdash: "—",
		hellip: "…",
		copy: "©",
		reg: "®",
		trade: "™",
	};

	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match: string, entity: string) => {
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const codePoint = Number.parseInt(entity.slice(2), 16);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
		}
		if (entity.startsWith("#")) {
			const codePoint = Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
		}
		return namedEntities[entity] ?? _match;
	});
}

function normalizeText(text: string): string {
	const lines = text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) => line.replace(/[\t ]+/g, " ").trim());

	const compact: string[] = [];
	let previousBlank = false;
	for (const line of lines) {
		const isBlank = line.length === 0;
		if (isBlank) {
			if (!previousBlank) compact.push("");
			previousBlank = true;
			continue;
		}
		compact.push(line);
		previousBlank = false;
	}

	return compact.join("\n").trim();
}

function stripTags(value: string): string {
	return value.replace(/<[^>]+>/g, " ");
}

function removeNoiseBlocks(html: string): string {
	let result = html;

	result = result.replace(/<!--[\s\S]*?-->/g, " ");
	result = result.replace(/<(script|style|noscript|template|svg|canvas|iframe|form|button|input|select|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
	result = result.replace(/<(header|footer|nav|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
	result = result.replace(/<([a-z0-9:_-]+)([^>]*(?:id|class)=["'][^"']*(?:nav|menu|footer|header|sidebar|cookie|advert|ads|promo|social|share|comment|related|newsletter|subscribe|breadcrumb|modal|popup|banner)[^"']*["'][^>]*)>[\s\S]*?<\/\1>/gi, " ");
	result = result.replace(/<([a-z0-9:_-]+)[^>]*style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");

	return result;
}

function extractMainHtml(html: string): string {
	const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
	const body = bodyMatch?.[1] ?? html;
	const cleanedBody = removeNoiseBlocks(body);

	const candidates: string[] = [];
	const collector = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/gi;
	let match = collector.exec(cleanedBody);
	while (match) {
		candidates.push(match[2]);
		match = collector.exec(cleanedBody);
	}

	if (candidates.length === 0) {
		return cleanedBody;
	}

	let best = candidates[0];
	let bestScore = normalizeText(decodeHtmlEntities(stripTags(best))).length;
	for (const candidate of candidates.slice(1)) {
		const score = normalizeText(decodeHtmlEntities(stripTags(candidate))).length;
		if (score > bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return removeNoiseBlocks(best);
}

function htmlToReadableText(html: string): string {
	const withStructure = html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|section|article|main|h[1-6]|pre|blockquote|tr|table)>/gi, "\n\n")
		.replace(/<li\b[^>]*>/gi, "\n- ")
		.replace(/<\/(li|ul|ol)>/gi, "\n");

	const withoutTags = stripTags(withStructure);
	return normalizeText(decodeHtmlEntities(withoutTags));
}

function toInlineMarkdown(html: string): string {
	let value = html;

	value = value.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m: string, href: string, text: string) => {
		const label = toInlineMarkdown(text) || href;
		return `[${label}](${href})`;
	});

	value = value.replace(/<(strong|b)\b[^>]*>/gi, "**").replace(/<\/(strong|b)>/gi, "**");
	value = value.replace(/<(em|i)\b[^>]*>/gi, "*").replace(/<\/(em|i)>/gi, "*");
	value = value.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m: string, text: string) => {
		const cleaned = normalizeText(decodeHtmlEntities(stripTags(text)));
		return cleaned.length > 0 ? `\`${cleaned}\`` : "";
	});
	value = value.replace(/<br\s*\/?>/gi, " ");
	value = stripTags(value);
	value = decodeHtmlEntities(value);
	value = value.replace(/[\t ]+/g, " ").trim();
	return value;
}

function htmlToMarkdown(html: string): string {
	const codeBlocks: string[] = [];
	let value = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m: string, codeHtml: string) => {
		const codeText = decodeHtmlEntities(stripTags(codeHtml)).replace(/\r\n?/g, "\n").trim();
		const token = `@@PI_CODE_BLOCK_${codeBlocks.length}@@`;
		codeBlocks.push(`\n\n\`\`\`\n${codeText}\n\`\`\`\n\n`);
		return token;
	});

	value = value.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m: string, level: string, text: string) => {
		const heading = toInlineMarkdown(text);
		const depth = Number.parseInt(level, 10);
		return heading.length > 0 ? `\n\n${"#".repeat(depth)} ${heading}\n\n` : "\n\n";
	});

	value = value.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m: string, text: string) => {
		const quote = toInlineMarkdown(text);
		if (!quote) return "\n\n";
		const quoteLines = quote.split("\n").map((line) => `> ${line}`);
		return `\n\n${quoteLines.join("\n")}\n\n`;
	});

	value = value.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, text: string) => {
		const item = toInlineMarkdown(text);
		return item.length > 0 ? `\n- ${item}` : "\n";
	});

	value = value.replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n");
	value = value.replace(/<br\s*\/?>/gi, "\n");
	value = value.replace(/<\/(p|div|section|article|main|table|tr)>/gi, "\n\n");
	value = value.replace(/<p\b[^>]*>/gi, "");
	value = value.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m: string, href: string, text: string) => {
		const label = toInlineMarkdown(text) || href;
		return `[${label}](${href})`;
	});
	value = value.replace(/<(strong|b)\b[^>]*>/gi, "**").replace(/<\/(strong|b)>/gi, "**");
	value = value.replace(/<(em|i)\b[^>]*>/gi, "*").replace(/<\/(em|i)>/gi, "*");
	value = value.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m: string, text: string) => {
		const cleaned = decodeHtmlEntities(stripTags(text)).trim();
		return cleaned.length > 0 ? `\`${cleaned}\`` : "";
	});

	value = stripTags(value);
	value = decodeHtmlEntities(value);

	for (let i = 0; i < codeBlocks.length; i += 1) {
		const token = `@@PI_CODE_BLOCK_${i}@@`;
		value = value.replace(token, codeBlocks[i]);
	}

	value = value
		.replace(/[\t ]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/[\t ]{2,}/g, " ");

	return value.trim();
}

function transformResponseText(rawText: string, contentType: string | undefined, requestedFormat: OutputFormat): {
	text: string;
	appliedFormat: OutputFormat;
} {
	if (requestedFormat === "raw") {
		return { text: rawText, appliedFormat: "raw" };
	}

	if (!isHtmlResponse(contentType, rawText)) {
		return { text: rawText, appliedFormat: "raw" };
	}

	try {
		const extractedHtml = extractMainHtml(rawText);
		const readableText = htmlToReadableText(extractedHtml);
		if (!readableText) {
			return { text: rawText, appliedFormat: "raw" };
		}

		if (requestedFormat === "readable") {
			return { text: readableText, appliedFormat: "readable" };
		}

		const markdown = htmlToMarkdown(extractedHtml);
		if (!markdown) {
			return { text: readableText, appliedFormat: "readable" };
		}
		return { text: markdown, appliedFormat: "markdown" };
	} catch {
		return { text: rawText, appliedFormat: "raw" };
	}
}

export default function webFetch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: `Fetch content from a URL. Supports HTTP methods, custom headers, optional request body, and HTML readability/markdown extraction. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. If truncated, full output is saved to a temp file.`,
		parameters: FetchParams,

		async execute(_toolCallId, params, signal) {
			const { url, method = "GET", headers, body, format = "raw", timeoutMs } = params as FetchArgs;
			const effectiveTimeoutMs = clampTimeout(timeoutMs);
			const details: FetchDetails = {
				url,
				method,
				requestedFormat: format,
				appliedFormat: "raw",
				timeoutMs: effectiveTimeoutMs,
			};

			const urlValidation = validateUrl(url);
			if (!urlValidation.ok) {
				details.error = urlValidation.message;
				return {
					content: [{ type: "text" as const, text: `Fetch blocked: ${urlValidation.message}` }],
					details,
					isError: true,
				};
			}

			let timedOut = false;
			const timeoutController = new AbortController();
			const timeoutHandle = setTimeout(() => {
				timedOut = true;
				timeoutController.abort(`Request timed out after ${effectiveTimeoutMs}ms`);
			}, effectiveTimeoutMs);

			const requestSignal = signal
				? AbortSignal.any([signal, timeoutController.signal])
				: timeoutController.signal;

			try {
				const response = await fetch(url, {
					method,
					headers: headers ? new Headers(headers) : undefined,
					body: body && supportsRequestBody(method) ? body : undefined,
					signal: requestSignal,
					redirect: "follow",
				});

				details.status = response.status;
				details.statusText = response.statusText;
				details.contentType = response.headers.get("content-type") ?? undefined;

				const rawText = await response.text();
				const transformed = transformResponseText(rawText, details.contentType, format);
				details.appliedFormat = transformed.appliedFormat;

				const headerLines: string[] = [
					`HTTP ${response.status} ${response.statusText}`,
					`Content-Type: ${details.contentType ?? "unknown"}`,
					`Mode: ${details.appliedFormat}${details.appliedFormat !== details.requestedFormat ? ` (requested ${details.requestedFormat})` : ""}`,
					"",
				];

				const fullOutput = `${headerLines.join("\n")}${transformed.text}`;
				const truncation = truncateHead(fullOutput, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let resultText = truncation.content;
				if (truncation.truncated) {
					const tempDir = mkdtempSync(join(tmpdir(), "pi-fetch-"));
					const tempFile = join(tempDir, "response.txt");
					writeFileSync(tempFile, fullOutput, "utf8");

					details.truncated = true;
					details.fullOutputPath = tempFile;

					resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
					resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
					resultText += ` Full output saved to: ${tempFile}]`;
				}

				return {
					content: [{ type: "text" as const, text: resultText }],
					details,
					isError: response.status >= 400,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				details.error = message;

				if (timedOut) {
					return {
						content: [{ type: "text" as const, text: `Fetch timed out after ${effectiveTimeoutMs}ms` }],
						details,
						isError: true,
					};
				}

				if (signal?.aborted) {
					return {
						content: [{ type: "text" as const, text: "Request cancelled" }],
						details,
						isError: true,
					};
				}

				return {
					content: [{ type: "text" as const, text: `Fetch failed: ${message}` }],
					details,
					isError: true,
				};
			} finally {
				clearTimeout(timeoutHandle);
			}
		},

		renderCall(args, theme) {
			const method = typeof args.method === "string" ? args.method : "GET";
			const format = typeof args.format === "string" ? args.format : "raw";

			let text = theme.fg("toolTitle", theme.bold("web_fetch "));
			if (method !== "GET") {
				text += theme.fg("accent", `${method} `);
			}
			text += theme.fg("muted", String(args.url));
			if (format !== "raw") {
				text += theme.fg("dim", ` [${format}]`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as FetchDetails | undefined;

			if (isPartial) {
				return new Text(theme.fg("warning", "Fetching..."), 0, 0);
			}

			if (!details?.status) {
				const content = result.content[0];
				const msg = content?.type === "text" ? content.text : "Request failed";
				return new Text(theme.fg("error", msg), 0, 0);
			}

			const statusColor = details.status < 400 ? "success" : "error";
			let text = theme.fg(statusColor, `${details.status} ${details.statusText ?? ""}`.trim());
			if (details.contentType) {
				text += theme.fg("dim", ` (${details.contentType})`);
			}
			text += theme.fg("muted", ` [${details.appliedFormat}]`);
			if (details.truncated) {
				text += theme.fg("warning", " [truncated]");
			}

			if (expanded) {
				const content = result.content[0];
				if (content?.type === "text") {
					const lines = content.text.split("\n").slice(0, 30);
					for (const line of lines) {
						text += `\n${theme.fg("dim", line)}`;
					}
					if (content.text.split("\n").length > 30) {
						text += `\n${theme.fg("muted", "...")}`;
					}
				}

				if (details.fullOutputPath) {
					text += `\n${theme.fg("dim", `Full output: ${details.fullOutputPath}`)}`;
				}
			}

			return new Text(text, 0, 0);
		},
	});
}
