import test from "node:test";
import assert from "node:assert/strict";
import {
	buildFailureKey,
	buildFailureMessage,
	getFailedChecks,
	CiWatchController,
	type CheckInfo,
	type ExecCall,
	type ExecResult,
	type PrInfo,
} from "./core.ts";

const pr: PrInfo = {
	number: 123,
	title: "Add checkout flow",
	url: "https://github.com/acme/shop/pull/123",
	headRefName: "feature/checkout",
	headRefOid: "abc123",
};

test("getFailedChecks returns fail buckets and optionally cancelled checks", () => {
	const checks: CheckInfo[] = [
		{ name: "lint", bucket: "pass", state: "SUCCESS" },
		{ name: "test", workflow: "CI", bucket: "fail", state: "FAILURE", link: "https://example.test/test" },
		{ name: "deploy", bucket: "cancel", state: "CANCELLED" },
	];

	assert.deepEqual(
		getFailedChecks(checks, { includeCancelled: true }).map((check) => check.name),
		["test", "deploy"],
	);
	assert.deepEqual(
		getFailedChecks(checks, { includeCancelled: false }).map((check) => check.name),
		["test"],
	);
});

test("buildFailureKey is stable across check order", () => {
	const a = buildFailureKey(pr, [
		{ name: "test", bucket: "fail", state: "FAILURE" },
		{ name: "lint", bucket: "fail", state: "FAILURE" },
	]);
	const b = buildFailureKey(pr, [
		{ name: "lint", bucket: "fail", state: "FAILURE" },
		{ name: "test", bucket: "fail", state: "FAILURE" },
	]);

	assert.equal(a, b);
	assert.equal(a, "123:abc123:lint,test");
});

test("buildFailureMessage includes PR and failed check details", () => {
	const message = buildFailureMessage(pr, [
		{ name: "test", workflow: "CI", bucket: "fail", state: "FAILURE", link: "https://example.test/test" },
	]);

	assert.match(message, /CI failed for PR #123/);
	assert.match(message, /Add checkout flow/);
	assert.match(message, /https:\/\/github.com\/acme\/shop\/pull\/123/);
	assert.match(message, /CI \/ test/);
	assert.match(message, /https:\/\/example.test\/test/);
	assert.match(message, /smallest fix/);
});

test("controller does not overlap PR discovery polls", async () => {
	let viewCalls = 0;
	let releaseView: (() => void) | undefined;
	let resolveViewStarted: (() => void) | undefined;
	const viewStarted = new Promise<void>((resolve) => {
		resolveViewStarted = resolve;
	});

	const exec = async (call: ExecCall): Promise<ExecResult> => {
		if (call.args[0] === "pr" && call.args[1] === "view") {
			viewCalls += 1;
			resolveViewStarted?.();
			await new Promise<void>((release) => {
				releaseView = release;
			});
			return { code: 1, stdout: "", stderr: "no pull requests found" };
		}
		throw new Error(`unexpected call: ${call.command} ${call.args.join(" ")}`);
	};

	const controller = new CiWatchController({
		cwd: "/repo",
		exec,
		isIdle: () => true,
		sendUserMessage: () => {},
		notify: () => {},
	});

	const firstPoll = controller.pollNow();
	await viewStarted;
	await controller.pollNow();

	assert.equal(viewCalls, 1);
	releaseView?.();
	await firstPoll;
});

test("controller starts a background gh watch and sends one message on failed checks", async () => {
	const calls: ExecCall[] = [];
	const sentMessages: Array<{ message: string; deliverAs?: "followUp" }> = [];
	const appended: unknown[] = [];

	const exec = async (call: ExecCall): Promise<ExecResult> => {
		calls.push(call);
		if (call.args[0] === "pr" && call.args[1] === "view") {
			return { code: 0, stdout: JSON.stringify(pr), stderr: "" };
		}
		if (call.args.includes("--watch")) {
			return { code: 1, stdout: "", stderr: "failed" };
		}
		if (call.args[0] === "pr" && call.args[1] === "checks") {
			return {
				code: 0,
				stdout: JSON.stringify([
					{ name: "lint", bucket: "pass", state: "SUCCESS" },
					{ name: "test", workflow: "CI", bucket: "fail", state: "FAILURE", link: "https://example.test/test" },
				]),
				stderr: "",
			};
		}
		throw new Error(`unexpected call: ${call.command} ${call.args.join(" ")}`);
	};

	const controller = new CiWatchController({
		cwd: "/repo",
		exec,
		isIdle: () => false,
		sendUserMessage: (message, options) => sentMessages.push({ message, deliverAs: options?.deliverAs }),
		notify: () => {},
		appendState: (data) => appended.push(data),
	});

	await controller.pollNow();
	await controller.waitForCurrentWatch();
	await controller.pollNow();
	await controller.waitForCurrentWatch();

	assert.equal(sentMessages.length, 1);
	assert.equal(sentMessages[0].deliverAs, "followUp");
	assert.match(sentMessages[0].message, /CI failed for PR #123/);
	assert.equal(appended.length, 1);
	assert.ok(calls.some((call) => call.args.includes("--watch")));
});
