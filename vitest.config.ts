import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = process.cwd();

export default defineConfig({
	/**
	 * Keep tests focused on repository-owned extension sources.
	 */
	test: {
		globals: true,
		environment: "node",
		include: [".pi/extensions/**/*.test.ts", ".pi/extensions/**/*.spec.ts"],
		exclude: [
			".pi/npm/**",
			"node_modules/**",
			"tmp/**",
			".pi/extensions/process/node_modules/**",
			".pi/extensions/worktree/node_modules/**",
		],
		coverage: {
			enabled: false,
			reporter: ["text", "html", "json-summary", "lcov"],
			include: [
				".pi/extensions/loop.ts",
				".pi/extensions/task/{types.ts,params.ts,skills.ts,render.ts,subprocess.ts,execute.ts,index.ts}",
				".pi/extensions/worktree/*.ts",
				".pi/extensions/process/{config.ts,manager.ts,constants/*.ts,tools/**/*.ts,utils/*.ts}",
			],
			exclude: [
				".pi/extensions/**/*.test.ts",
				".pi/extensions/**/*.spec.ts",
				".pi/extensions/process/node_modules/**",
				".pi/extensions/worktree/node_modules/**",
				".pi/npm/**",
			],
		},
	},
	resolve: {
		alias: {
			"@aliou/pi-utils-ui": resolve(projectRoot, ".pi/extensions/process/node_modules/@aliou/pi-utils-ui/index.ts"),
			"@aliou/pi-utils-settings": resolve(projectRoot, ".pi/extensions/process/node_modules/@aliou/pi-utils-settings/index.ts"),
			"@mariozechner/pi-coding-agent": resolve(projectRoot, ".pi/npm/node_modules/@mariozechner/pi-coding-agent/dist/index.js"),
			"@mariozechner/pi-tui": resolve(projectRoot, ".pi/npm/node_modules/@mariozechner/pi-tui/dist/index.js"),
			"@mariozechner/pi-ai": resolve(projectRoot, ".pi/npm/node_modules/@mariozechner/pi-ai/dist/index.js"),
			"@mariozechner/pi-agent-core": resolve(projectRoot, ".pi/npm/node_modules/@mariozechner/pi-agent-core/dist/index.js"),
			"@sinclair/typebox": resolve(projectRoot, ".pi/npm/node_modules/@sinclair/typebox/build/esm/index.d.mts"),
		},
	},
});
