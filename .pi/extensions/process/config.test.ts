import { describe, expect, it } from "vitest";

import { configLoader } from "./config.js";

describe("process config", () => {
	it("provides default values", async () => {
		await configLoader.load();
		const cfg = configLoader.getConfig();
		expect(cfg.processList.maxVisibleProcesses).toBe(8);
		expect(cfg.processList.maxPreviewLines).toBe(12);
		expect(cfg.output.defaultTailLines).toBe(100);
		expect(cfg.output.maxOutputLines).toBe(200);
		expect(cfg.widget.showStatusWidget).toBe(true);
	});
});
