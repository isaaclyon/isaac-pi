import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const WEB_SEARCH_BETA = "web-search-2025-03-05";

interface ModelsJson {
	providers?: Record<string, { baseUrl?: string; apiKey?: string; api?: string }>;
}
interface AuthJson {
	anthropic?: { type: "oauth"; access: string; expires: number };
}
interface ClaudeCredentialsJson {
	claudeAiOauth?: { accessToken: string; expiresAt: number };
}
interface AuthConfig {
	apiKey: string;
	baseUrl: string;
	isOAuth: boolean;
}
interface Citation {
	url: string;
	title: string;
	cited_text: string;
}
interface WebSearchResult {
	type: "web_search_result";
	title: string;
	url: string;
	page_age: string | null;
}
interface ContentBlock {
	type: string;
	text?: string;
	citations?: Citation[];
	name?: string;
	input?: { query: string };
	content?: WebSearchResult[];
}
interface ApiResponse {
	model: string;
	content: ContentBlock[];
	usage: { input_tokens: number; output_tokens: number; server_tool_use?: { web_search_requests: number } };
}

const SearchSchema = Type.Object({
	query: Type.String({ description: "The question or search query" }),
	system_prompt: Type.Optional(Type.String({ description: "Optional guidance for response style/focus" })),
	max_tokens: Type.Optional(Type.Number({ description: "Maximum response tokens (default 4096)", minimum: 1, maximum: 16384 })),
});
type SearchParams = { query: string; system_prompt?: string; max_tokens?: number };

function parseEnvFile(filePath: string): Record<string, string> {
	if (!fs.existsSync(filePath)) return {};

	const values: Record<string, string> = {};

	try {
		const content = fs.readFileSync(filePath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;

			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			values[key] = value;
		}
	} catch {
		return {};
	}

	return values;
}

function getEnv(key: string): string | undefined {
	const fromProcess = process.env[key];
	if (fromProcess) return fromProcess;

	const localEnv = parseEnvFile(path.join(process.cwd(), ".env"));
	if (localEnv[key]) return localEnv[key];

	const homeEnv = parseEnvFile(path.join(os.homedir(), ".env"));
	if (homeEnv[key]) return homeEnv[key];

	return undefined;
}

function readJson<T>(filePath: string): T | null {
	if (!fs.existsSync(filePath)) return null;
	try {
		const data = fs.readFileSync(filePath, "utf-8");
		return JSON.parse(data) as T;
	} catch {
		return null;
	}
}

function isOAuthToken(apiKey: string): boolean {
	return apiKey.includes("sk-ant-oat");
}

function getConfiguredModel(): string {
	return getEnv("ANTHROPIC_SEARCH_MODEL") ?? DEFAULT_MODEL;
}

function findAuthConfig(): AuthConfig | null {
	const piAgentDir = path.join(os.homedir(), ".pi", "agent");

	const explicitApiKey = getEnv("ANTHROPIC_SEARCH_API_KEY");
	const explicitBaseUrl = getEnv("ANTHROPIC_SEARCH_BASE_URL");
	if (explicitApiKey) {
		return {
			apiKey: explicitApiKey,
			baseUrl: explicitBaseUrl ?? DEFAULT_BASE_URL,
			isOAuth: isOAuthToken(explicitApiKey),
		};
	}

	const modelsJson = readJson<ModelsJson>(path.join(piAgentDir, "models.json"));
	if (modelsJson?.providers) {
		for (const provider of Object.values(modelsJson.providers)) {
			if (provider.api === "anthropic-messages" && provider.apiKey && provider.apiKey !== "none") {
				return {
					apiKey: provider.apiKey,
					baseUrl: provider.baseUrl ?? DEFAULT_BASE_URL,
					isOAuth: isOAuthToken(provider.apiKey),
				};
			}
		}

		for (const provider of Object.values(modelsJson.providers)) {
			if (provider.api === "anthropic-messages" && provider.baseUrl) {
				return {
					apiKey: provider.apiKey ?? "",
					baseUrl: provider.baseUrl,
					isOAuth: false,
				};
			}
		}
	}

	const authJson = readJson<AuthJson>(path.join(piAgentDir, "auth.json"));
	if (authJson?.anthropic?.type === "oauth" && authJson.anthropic.access) {
		const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
		if (authJson.anthropic.expires > fiveMinutesFromNow) {
			return {
				apiKey: authJson.anthropic.access,
				baseUrl: DEFAULT_BASE_URL,
				isOAuth: true,
			};
		}
	}

	const claudeCredentials = readJson<ClaudeCredentialsJson>(path.join(os.homedir(), ".claude", ".credentials.json"));
	if (claudeCredentials?.claudeAiOauth?.accessToken) {
		const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
		if (claudeCredentials.claudeAiOauth.expiresAt > fiveMinutesFromNow) {
			return {
				apiKey: claudeCredentials.claudeAiOauth.accessToken,
				baseUrl: DEFAULT_BASE_URL,
				isOAuth: true,
			};
		}
	}

	const fallbackApiKey = getEnv("ANTHROPIC_API_KEY");
	const fallbackBaseUrl = getEnv("ANTHROPIC_BASE_URL");
	if (fallbackApiKey) {
		return {
			apiKey: fallbackApiKey,
			baseUrl: fallbackBaseUrl ?? DEFAULT_BASE_URL,
			isOAuth: isOAuthToken(fallbackApiKey),
		};
	}

	return null;
}

function buildUrl(auth: AuthConfig): string {
	const trimmedBaseUrl = auth.baseUrl.replace(/\/+$/, "");
	const base = `${trimmedBaseUrl}/v1/messages`;
	return auth.isOAuth ? `${base}?beta=true` : base;
}

function buildHeaders(auth: AuthConfig): Record<string, string> {
	const headers: Record<string, string> = {
		"anthropic-version": "2023-06-01",
		accept: "application/json",
		"content-type": "application/json",
	};

	if (auth.isOAuth) {
		headers.authorization = `Bearer ${auth.apiKey}`;
		headers["anthropic-dangerous-direct-browser-access"] = "true";
		headers["user-agent"] = "claude-cli/2.0.46 (external, cli)";
		headers["x-app"] = "cli";
		headers["anthropic-beta"] = [
			WEB_SEARCH_BETA,
			"oauth-2025-04-20",
			"claude-code-20250219",
			"prompt-caching-2024-07-31",
		].join(",");
		headers["x-stainless-arch"] = "x64";
		headers["x-stainless-lang"] = "js";
		headers["x-stainless-os"] = process.platform === "darwin" ? "MacOS" : process.platform;
		headers["x-stainless-package-version"] = "0.60.0";
		headers["x-stainless-retry-count"] = "1";
		headers["x-stainless-runtime"] = "node";
		headers["x-stainless-runtime-version"] = process.version;
	} else {
		headers["anthropic-beta"] = WEB_SEARCH_BETA;
		if (auth.apiKey) {
			headers["x-api-key"] = auth.apiKey;
		}
	}

	return headers;
}

async function callWebSearch(
	auth: AuthConfig,
	model: string,
	params: SearchParams,
	signal?: AbortSignal,
): Promise<ApiResponse> {
	const body: Record<string, unknown> = {
		model,
		max_tokens: params.max_tokens ?? 4096,
		messages: [{ role: "user", content: params.query }],
		tools: [{ type: "web_search_20250305", name: "web_search" }],
	};

	const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = [];

	if (auth.isOAuth) {
		systemBlocks.push({
			type: "text",
			text: "You are Claude Code, Anthropic's official CLI for Claude.",
			cache_control: { type: "ephemeral" },
		});
	}

	if (params.system_prompt) {
		systemBlocks.push({
			type: "text",
			text: params.system_prompt,
			...(auth.isOAuth ? { cache_control: { type: "ephemeral" as const } } : {}),
		});
	}

	if (systemBlocks.length > 0) {
		body.system = systemBlocks;
	}

	const response = await fetch(buildUrl(auth), {
		method: "POST",
		headers: buildHeaders(auth),
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
	}

	return (await response.json()) as ApiResponse;
}

function formatResponse(response: ApiResponse): { text: string; details: unknown } {
	const answerParts: string[] = [];
	const searchQueries: string[] = [];
	const sources: Array<{ title: string; url: string; age: string | null }> = [];
	const citations: Citation[] = [];

	for (const block of response.content) {
		if (block.type === "server_tool_use" && block.name === "web_search") {
			searchQueries.push(block.input?.query ?? "");
			continue;
		}

		if (block.type === "web_search_tool_result" && block.content) {
			for (const source of block.content) {
				if (source.type === "web_search_result") {
					sources.push({ title: source.title, url: source.url, age: source.page_age });
				}
			}
			continue;
		}

		if (block.type === "text" && block.text) {
			answerParts.push(block.text);
			if (block.citations) citations.push(...block.citations);
		}
	}

	let text = answerParts.join("\n\n");
	if (sources.length > 0) {
		text += "\n\n## Sources";
		for (const [index, source] of sources.entries()) {
			const age = source.age ? ` (${source.age})` : "";
			text += `\n[${index + 1}] ${source.title}${age}\n    ${source.url}`;
		}
	}

	return {
		text,
		details: {
			model: response.model,
			usage: response.usage,
			searchQueries,
			sources,
			citations: citations.map((citation) => ({
				title: citation.title,
				url: citation.url,
				citedText: citation.cited_text,
			})),
		},
	};
}

export default function anthropicWebSearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "anthropic_web_search",
		label: "Anthropic Web Search",
		description:
			"Search the web with Anthropic Claude web_search_20250305 and return a synthesized answer with sources.",
		parameters: SearchSchema,
		async execute(_toolCallId, params, signal) {
			const auth = findAuthConfig();
			if (!auth) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No Anthropic auth found. Use Claude Code login, ANTHROPIC_SEARCH_API_KEY, or configure ~/.pi/agent/models.json.",
						},
					],
					details: { error: "Missing Anthropic credentials" },
				};
			}

			const model = getConfiguredModel();

			try {
				const response = await callWebSearch(auth, model, params as SearchParams, signal);
				const formatted = formatResponse(response);
				return {
					content: [{ type: "text" as const, text: formatted.text }],
					details: formatted.details,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text" as const, text: `Error: ${message}` }],
					details: { error: message },
				};
			}
		},
	});
}
