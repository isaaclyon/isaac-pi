import { describe, expect, it } from "vitest";

import { LIVE_STATUSES, MESSAGE_TYPE_PROCESS_UPDATE } from "./constants/index.js";

describe("process constants", () => {
	it("exports expected event type and status set", () => {
		expect(MESSAGE_TYPE_PROCESS_UPDATE).toBe("ad-process:update");
		expect(LIVE_STATUSES).toEqual(
			expect.any(Set),
		);
		expect(LIVE_STATUSES.has("running")).toBe(true);
		expect(LIVE_STATUSES.has("terminating")).toBe(true);
		expect(LIVE_STATUSES.has("terminate_timeout")).toBe(true);
		expect(LIVE_STATUSES.has("exited")).toBe(false);
		expect(LIVE_STATUSES.has("killed")).toBe(false);
	});
});
