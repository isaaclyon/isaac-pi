import assert from "node:assert/strict";
import test from "node:test";
import { beginQuestionAttention, buildAttentionCopy } from "./attention.ts";

test("buildAttentionCopy uses the first header for a single question", () => {
	const copy = buildAttentionCopy({
		questions: [
			{
				header: "Auth method",
				question: "Which auth method should we use?",
				options: [
					{ label: "OAuth", description: "Use OAuth." },
					{ label: "JWT", description: "Use JWT." },
				],
			},
		],
	});

	assert.equal(copy.cmuxTitle, "Pi needs input");
	assert.equal(copy.cmuxSubtitle, "Auth method");
	assert.match(copy.uiStatus, /awaiting answer/i);
});

test("buildAttentionCopy summarizes multiple questions", () => {
	const copy = buildAttentionCopy({
		questions: [
			{
				header: "Database",
				question: "Which database should we use?",
				options: [
					{ label: "Postgres", description: "Use Postgres." },
					{ label: "SQLite", description: "Use SQLite." },
				],
			},
			{
				header: "ORM",
				question: "Which ORM should we use?",
				options: [
					{ label: "Prisma", description: "Use Prisma." },
					{ label: "Drizzle", description: "Use Drizzle." },
				],
			},
		],
	});

	assert.equal(copy.cmuxSubtitle, "2 questions waiting");
	assert.match(copy.cmuxBody, /Database/);
	assert.match(copy.uiStatus, /2 questions/);
});

test("beginQuestionAttention updates Pi status and cmux, then clears workspace status", () => {
	const messages: Array<{ type: string; value: string }> = [];
	const commands: Array<{ command: string; args: string[] }> = [];
	const stop = beginQuestionAttention(
		{
			hasUI: true,
			ui: {
				notify() {},
				setStatus(_key, value) {
					messages.push({ type: "status", value: value ?? "" });
				},
			},
		},
		{
			questions: [
				{
					header: "Framework",
					question: "Which framework should we use?",
					options: [
						{ label: "React", description: "Use React." },
						{ label: "Vue", description: "Use Vue." },
					],
				},
			],
		},
		{
			env: {
				CMUX_WORKSPACE_ID: "workspace:3",
				CMUX_SURFACE_ID: "surface:9",
			},
			runner(command, args) {
				commands.push({ command, args });
			},
		},
	);

	stop();

	assert.deepEqual(
		messages.map((entry) => entry.type),
		["status", "status"],
	);
	assert.equal(commands.length, 4);
	assert.deepEqual(commands[0], {
		command: "cmux",
		args: [
			"notify",
			"--title",
			"Pi needs input",
			"--subtitle",
			"Framework",
			"--body",
			"Answer the question in Pi to continue.",
			"--workspace",
			"workspace:3",
			"--surface",
			"surface:9",
		],
	});
	assert.deepEqual(commands[1], {
		command: "cmux",
		args: ["trigger-flash", "--workspace", "workspace:3", "--surface", "surface:9"],
	});
	assert.deepEqual(commands[2], {
		command: "cmux",
		args: [
			"set-status",
			"ask-user-question",
			"needs input",
			"--workspace",
			"workspace:3",
			"--color",
			"#f59e0b",
		],
	});
	assert.deepEqual(commands[3], {
		command: "cmux",
		args: ["clear-status", "ask-user-question", "--workspace", "workspace:3"],
	});
});
