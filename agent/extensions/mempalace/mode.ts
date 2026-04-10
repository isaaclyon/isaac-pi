export type MempalaceMemoryMode = "wake-only" | "selective";

export interface MempalaceModeState {
	mode: MempalaceMemoryMode;
}

export function parseMempalaceMemoryMode(value: string): MempalaceMemoryMode | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === "wake-only" || normalized === "selective") {
		return normalized;
	}
	return null;
}
