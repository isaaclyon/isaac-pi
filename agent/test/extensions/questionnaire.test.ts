import { describe, expect, it } from "vitest";

import { isFinalSubmitShortcut } from "../../extensions/questionnaire.js";

describe("questionnaire final submit shortcut", () => {
	it("accepts 1 as an alternate submit shortcut", () => {
		expect(isFinalSubmitShortcut("1")).toBe(true);
		expect(isFinalSubmitShortcut("2")).toBe(false);
	});
});
