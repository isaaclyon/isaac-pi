import { MANAGED_PREFIX, isManagedSession, isValidName, sanitizeSlug, timestamp } from "./constants";
import { makeToolError } from "./results";
import type { ToolError } from "./types";

export function resolveManagedSessionName(sessionName: string | undefined, taskSlug: string | undefined): string {
	if (sessionName?.trim()) return sessionName.trim();
	const slug = sanitizeSlug(taskSlug ?? "task");
	return `${MANAGED_PREFIX}${slug}-${timestamp()}`.slice(0, 64);
}

export function validateManagedSessionName(name: string): ToolError | undefined {
	if (!isValidName(name)) return makeToolError(`Invalid session name: ${name}`, "INVALID_ARGUMENT");
	if (!isManagedSession(name)) {
		return makeToolError(`Session must start with managed prefix (${MANAGED_PREFIX})`, "INVALID_ARGUMENT");
	}
	return undefined;
}

export function validateWindowName(name: string): ToolError | undefined {
	if (!isValidName(name)) return makeToolError(`Invalid window name: ${name}`, "INVALID_ARGUMENT");
	return undefined;
}
