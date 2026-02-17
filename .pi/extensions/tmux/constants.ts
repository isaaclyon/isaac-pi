export const MANAGED_PREFIX = "pi-";
export const DEFAULT_WINDOW = "main";
export const DEFAULT_CAPTURE_LINES = 200;
export const DEFAULT_CAPTURE_TIMEOUT_SEC = 30;
export const DEFAULT_RUN_TIMEOUT_SEC = 600;
export const DEFAULT_STALE_TTL_SEC = 86_400;

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function nowEpochSec(): number {
	return Math.floor(Date.now() / 1000);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeSlug(input: string): string {
	const cleaned = input.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
	return cleaned || "task";
}

export function timestamp(): string {
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const mi = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export function isManagedSession(name: string): boolean {
	return name.startsWith(MANAGED_PREFIX);
}

export function isValidName(name: string): boolean {
	return NAME_PATTERN.test(name);
}

export function stripAnsi(input: string): string {
	return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

export function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
