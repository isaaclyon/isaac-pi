type NotifyLevel = "info" | "warning" | "error";

type NotifyFn = (text: string, level: NotifyLevel) => void;

export interface MempalaceDebugState {
	enabled: boolean;
}

export interface MempalaceDebugMeta {
	action: "status" | "search" | "sync";
	bootstrapped?: boolean;
	query?: string;
}

interface NotifyContext {
	ui?: {
		notify?: NotifyFn;
	};
}

function quoteQuery(query: string): string {
	const normalized = query.trim().replace(/\s+/g, " ");
	const excerpt = normalized.slice(0, 60);
	const suffix = normalized.length > excerpt.length ? "…" : "";
	return `'${excerpt}${suffix}'`;
}

function notify(ctx: NotifyContext, text: string): void {
	ctx.ui?.notify?.(text, "info");
}

export function emitMempalaceDebug(ctx: NotifyContext, state: MempalaceDebugState, meta: MempalaceDebugMeta): void {
	if (!state.enabled) {
		return;
	}

	switch (meta.action) {
		case "status":
			notify(ctx, "MemPalace: status");
			break;
		case "sync":
			notify(ctx, "MemPalace: sync");
			break;
		case "search":
			notify(ctx, meta.query ? `MemPalace: search ${quoteQuery(meta.query)}` : "MemPalace: search");
			break;
	}

	if (meta.bootstrapped) {
		notify(ctx, "MemPalace: auto-init repo");
	}
}

export function emitMempalaceDebugText(ctx: NotifyContext, state: MempalaceDebugState, text: string): void {
	if (!state.enabled) {
		return;
	}
	notify(ctx, text);
}
