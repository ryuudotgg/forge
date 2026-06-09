import { defineAddon, projectTarget, surfaceLines } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import type { FirstPartyAddonMetadata } from "../registry/types";

const gitignore = defineAddon<ForgeConfig, "gitignore">({
	id: "gitignore",
	name: ".gitignore",
	version: "0.1.0",
	category: "tooling",
	exclusive: false,
	targetMode: "single",
	when: () => true,
	contribute: ({ config }) => {
		const buildLines = ["dist/", "build/", "out/", ".turbo/", ".cache/"];
		if (config.web === "nextjs") buildLines.push(".next/");
		if (config.mobile) buildLines.push(".expo/");

		return [
			surfaceLines(projectTarget(), "gitignore", ["node_modules/"], {
				section: "Dependencies",
			}),
			surfaceLines(projectTarget(), "gitignore", [".forge/"], {
				section: "Forge",
			}),
			surfaceLines(projectTarget(), "gitignore", buildLines, {
				section: "Build",
			}),
			surfaceLines(projectTarget(), "gitignore", [".vercel/"], {
				section: "Vercel",
			}),
			surfaceLines(projectTarget(), "gitignore", ["coverage/"], {
				section: "Testing",
			}),
			surfaceLines(
				projectTarget(),
				"gitignore",
				[
					".env",
					".env.local",
					".env.development.local",
					".env.test.local",
					".env.production.local",
				],
				{ section: "Environment" },
			),
			surfaceLines(projectTarget(), "gitignore", ["npm-debug.log*"], {
				section: "Debug",
			}),
			surfaceLines(
				projectTarget(),
				"gitignore",
				[".DS_Store", "Thumbs.db", "*.pem"],
				{ section: "Misc" },
			),
		];
	},
});

export const gitignoreMetadata = {
	description:
		"Adds Forge's managed .gitignore entries for common generated outputs and tooling.",
	experimental: false,
	hidden: false,
	id: "gitignore",
	keywords: ["git", "gitignore", "tooling"],
	kind: "addon",
	name: ".gitignore",
	summary: "Add managed .gitignore entries.",
} as const satisfies FirstPartyAddonMetadata;

export default gitignore;
