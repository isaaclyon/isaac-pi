import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, win32 } from "node:path";
import {
	discoverInstructionFiles,
	expandHome,
	extractPathCandidates,
	formatProjectContext,
	normalizeCandidatePath,
	resolveStartDirectory,
	isPathInsideOrEqual,
	isRelativePathInsideOrEqual,
} from "./context.ts";

test("extractPathCandidates covers typed built-ins and aliases", () => {
	assert.deepEqual(extractPathCandidates("read", { path: "@src/app.ts" }), ["@src/app.ts"]);
	assert.deepEqual(extractPathCandidates("write", { path: "new.ts", content: "not/a/path" }), ["new.ts"]);
	assert.deepEqual(extractPathCandidates("edit", { path: "src/app.ts", edits: [] }), ["src/app.ts"]);
	assert.deepEqual(extractPathCandidates("ls", { path: "src" }), ["src"]);
	assert.deepEqual(extractPathCandidates("list", { path: "src" }), ["src"]);
	assert.deepEqual(extractPathCandidates("grep", { path: "src", pattern: "foo/bar", glob: "*.ts" }), ["src"]);
	assert.deepEqual(extractPathCandidates("search", { path: "src", pattern: "foo/bar" }), ["src"]);
	assert.deepEqual(extractPathCandidates("find", { path: "src", pattern: "*.ts" }), ["src"]);
});

test("extractPathCandidates scans conservative future path-like fields", () => {
	assert.deepEqual(
		extractPathCandidates("future_tool", {
			filePath: "src/a.ts",
			paths: ["src/b.ts", 7, "src/c.ts"],
			nested: { sourcePath: "src/in.ts", destinationPath: "src/out.ts" },
			pattern: "ignored/pattern",
			glob: "ignored/glob",
			content: "ignored/content",
		}),
		["src/a.ts", "src/b.ts", "src/c.ts", "src/in.ts", "src/out.ts"],
	);
});

test("extractPathCandidates ignores bash command strings", () => {
	assert.deepEqual(extractPathCandidates("bash", { command: "cat nested/AGENTS.md" }), []);
	assert.deepEqual(extractPathCandidates("future_tool", { command: "cat nested/AGENTS.md" }), []);
});

test("normalization handles @, home, relative, existing, and missing paths", () => {
	const cwd = mkdtempSync(join(tmpdir(), "nested-context-normalize-"));
	const dir = join(cwd, "src");
	const file = join(dir, "app.ts");
	mkdirSync(dir);
	writeFileSync(file, "export {};\n");

	assert.equal(expandHome("~/demo"), join(homedir(), "demo"));
	assert.equal(normalizeCandidatePath("@src/app.ts", cwd), realpathSync.native(file));
	assert.equal(normalizeCandidatePath("src/missing.ts", cwd), join(cwd, "src", "missing.ts"));
	assert.equal(resolveStartDirectory("src/missing.ts", cwd), realpathSync.native(dir));
	assert.equal(resolveStartDirectory("src", cwd), realpathSync.native(dir));
});

test("isPathInsideOrEqual rejects sibling prefix matches", () => {
	const parent = mkdtempSync(join(tmpdir(), "nested-context-boundary-"));
	const cwd = join(parent, "repo");
	const sibling = join(parent, "repository");
	mkdirSync(join(cwd, "sub"), { recursive: true });
	mkdirSync(join(sibling, "sub"), { recursive: true });

	assert.equal(isPathInsideOrEqual(join(cwd, "sub"), cwd), true);
	assert.equal(isPathInsideOrEqual(sibling, cwd), false);
});

test("relative boundary helper handles Windows separators", () => {
	assert.equal(
		isRelativePathInsideOrEqual(win32.relative("C:\\repo", "C:\\repo\\sub"), win32.isAbsolute),
		true,
	);
	assert.equal(
		isRelativePathInsideOrEqual(win32.relative("C:\\repo", "C:\\repository"), win32.isAbsolute),
		false,
	);
	assert.equal(
		isRelativePathInsideOrEqual(win32.relative("C:\\repo", "D:\\other"), win32.isAbsolute),
		false,
	);
});

test("discoverInstructionFiles is cwd-bounded, deterministic, shallow-to-deep, and precedence-aware", () => {
	const cwd = mkdtempSync(join(tmpdir(), "nested-context-discover-"));
	const sub = join(cwd, "sub");
	const deep = join(sub, "deep");
	const outside = mkdtempSync(join(tmpdir(), "nested-context-outside-"));
	mkdirSync(deep, { recursive: true });
	writeFileSync(join(cwd, "AGENTS.md"), "root agents");
	writeFileSync(join(sub, "CLAUDE.md"), "sub claude");
	writeFileSync(join(sub, "AGENTS.md"), "sub agents wins");
	writeFileSync(join(deep, "CLAUDE.md"), "deep claude");
	writeFileSync(join(outside, "AGENTS.md"), "outside agents");

	const files = discoverInstructionFiles(deep, cwd).map((file) => file.path);
	assert.deepEqual(files, [
		join(realpathSync.native(cwd), "AGENTS.md"),
		join(realpathSync.native(sub), "AGENTS.md"),
		join(realpathSync.native(deep), "CLAUDE.md"),
	]);
	assert.deepEqual(discoverInstructionFiles(outside, cwd), []);
});

test("discoverInstructionFiles dedupes instruction files by realpath", { skip: process.platform === "win32" }, () => {
	const cwd = mkdtempSync(join(tmpdir(), "nested-context-symlink-"));
	const real = join(cwd, "real");
	const alias = join(cwd, "alias");
	mkdirSync(real);
	writeFileSync(join(real, "AGENTS.md"), "real agents");
	symlinkSync(real, alias, "dir");

	const files = discoverInstructionFiles(alias, cwd);
	assert.deepEqual(files.map((file) => file.realPath), [realpathSync.native(join(real, "AGENTS.md"))]);
});

test("formatProjectContext mirrors Pi project instruction tags", () => {
	const formatted = formatProjectContext([{ path: "/repo/sub/AGENTS.md", content: "Use local rules." }]);
	assert.match(formatted, /<project_context>/);
	assert.match(formatted, /Project-specific instructions and guidelines/);
	assert.match(formatted, /<project_instructions path="\/repo\/sub\/AGENTS.md">\nUse local rules\.\n<\/project_instructions>/);
	assert.match(formatted, /<\/project_context>/);
	assert.equal(formatProjectContext([]), "");
});
