const PI_ROOT = "/Users/isaaclyon/.local/share/fnm/node-versions/v22.22.0/installation/lib/node_modules/@mariozechner/pi-coding-agent";
const PI_NODE_MODULES = `${PI_ROOT}/node_modules`;

export default {
	test: {
		environment: "node",
	},
	resolve: {
		alias: {
			"@mariozechner/pi-coding-agent": PI_ROOT,
			"@mariozechner/pi-tui": `${PI_NODE_MODULES}/@mariozechner/pi-tui`,
			"@mariozechner/pi-ai": `${PI_NODE_MODULES}/@mariozechner/pi-ai`,
			"@mariozechner/pi-agent-core": `${PI_NODE_MODULES}/@mariozechner/pi-agent-core`,
			"@sinclair/typebox": `${PI_NODE_MODULES}/@sinclair/typebox`,
		},
	},
};
