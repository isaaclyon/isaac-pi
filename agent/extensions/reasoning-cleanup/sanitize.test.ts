import assert from "node:assert/strict";
import test from "node:test";
import { stripEmptyHtmlComments } from "./sanitize.ts";

test("removes empty HTML comment separators from reasoning", () => {
	assert.equal(
		stripEmptyHtmlComments("**First thought**\n\n<!-- -->\n\n**Second thought**\n\n<!-- -->"),
		"**First thought**\n\n**Second thought**",
	);
});

test("preserves non-empty HTML comments and ordinary text", () => {
	const input = "Keep <!-- meaningful --> this <!--comment--> intact.";
	assert.equal(stripEmptyHtmlComments(input), input);
});

test("recognizes whitespace-only comments", () => {
	assert.equal(stripEmptyHtmlComments("Before\n\n<!--   -->\n\nAfter"), "Before\n\nAfter");
});
