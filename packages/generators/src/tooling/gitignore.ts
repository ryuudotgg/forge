import { defineAddon, filePath, lines } from "@ryuujs/core";
import type { ForgeConfig } from "../config";

const gitignore = defineAddon<ForgeConfig, "gitignore">({
	id: "gitignore",
	name: ".gitignore",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: ({ config }) => {
		const buildLines = ["dist/", ".turbo/", ".cache/"];
		if (config.web === "nextjs") buildLines.push(".next/");
		if (config.mobile) buildLines.push(".expo/");

		return [
			lines(filePath(".gitignore"), ["node_modules/"], {
				section: "Dependencies",
			}),
			lines(filePath(".gitignore"), buildLines, { section: "Build" }),
			lines(filePath(".gitignore"), [".env", ".env.local", ".env*.local"], {
				section: "Environment",
			}),
			lines(filePath(".gitignore"), [".DS_Store", "Thumbs.db"], {
				section: "OS",
			}),
		];
	},
});

export default gitignore;
