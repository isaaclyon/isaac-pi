import { describe, expect, it } from "vitest";

import { deriveProjectMemoryConfig } from "./config.js";

describe("deriveProjectMemoryConfig", () => {
	it("derives repo-local memory paths and a sanitized wing name", () => {
		const config = deriveProjectMemoryConfig("/work/My App.repo");

		expect(config.projectRoot).toBe("/work/My App.repo");
		expect(config.projectName).toBe("My App.repo");
		expect(config.projectWing).toBe("wing_my_app_repo");
		expect(config.memoryRoot).toBe("/work/My App.repo/.pi/memory/mempalace");
		expect(config.palaceRoot).toBe("/work/My App.repo/.pi/memory/mempalace/palace");
		expect(config.ingestRoot).toBe("/work/My App.repo/.pi/memory/mempalace/ingest/pi-session");
		expect(config.statePath).toBe("/work/My App.repo/.pi/memory/mempalace/state.json");
	});

	it("falls back to wing_project when the repo name has no word characters", () => {
		const config = deriveProjectMemoryConfig("/work/---");
		expect(config.projectWing).toBe("wing_project");
	});
});
