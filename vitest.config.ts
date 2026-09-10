import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The `obsidian` npm package ships typings only — it has no runtime module.
// Alias it to our stub so plugin/command code can be imported in tests.
export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(
				new URL("./src/testing/obsidian-stub.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
