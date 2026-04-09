import {
	defineAddon,
	leafTextFile,
	selectedModuleTarget,
	surfaceDependencies,
	surfaceLines,
	surfaceScripts,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { readTemplate } from "../../template";

const drizzle = defineAddon<ForgeConfig, "drizzle", "nextjs">({
	id: "drizzle",
	name: "Drizzle",
	version: "0.1.0",
	category: "orm",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	compatibility: {
		app: {
			frameworks: ["nextjs"],
			requiredSlots: ["db"],
		},
	},
	when: (config) => config.orm === "drizzle",
	contribute: () => [
		leafTextFile(
			selectedModuleTarget(),
			"drizzle.config.ts",
			readTemplate("orm/drizzle/drizzle.config.ts"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/db/index.ts",
			readTemplate("orm/drizzle/src/db/index.ts"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/db/schema.ts",
			readTemplate("orm/drizzle/src/db/schema.ts"),
		),
		surfaceDependencies(selectedModuleTarget(), "packageJson", [
			{ ...deps.drizzleOrm, type: "dependencies" },
			{ ...deps.neonServerless, type: "dependencies" },
			{ ...deps.drizzleKit, type: "devDependencies" },
		]),
		surfaceScripts(selectedModuleTarget(), "packageJson", {
			"db:generate": "drizzle-kit generate",
			"db:migrate": "drizzle-kit migrate",
			"db:push": "drizzle-kit push",
			"db:studio": "drizzle-kit studio",
		}),
		surfaceLines(selectedModuleTarget(), "env", ["DATABASE_URL="], {
			section: "Database",
		}),
		surfaceLines(selectedModuleTarget(), "envExample", ["DATABASE_URL="], {
			section: "Database",
		}),
	],
});

export default drizzle;
