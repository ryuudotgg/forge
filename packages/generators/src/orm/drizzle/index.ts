import {
	defineAddon,
	dependencies,
	envEntries,
	filePath,
	scripts,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { templateFiles } from "../../template";

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
		...templateFiles("orm/drizzle", "apps/web"),
		dependencies(filePath("apps/web/package.json"), [
			{ ...deps.drizzleOrm, type: "dependencies" },
			{ ...deps.neonServerless, type: "dependencies" },
			{ ...deps.drizzleKit, type: "devDependencies" },
		]),
		scripts(filePath("apps/web/package.json"), {
			"db:generate": "drizzle-kit generate",
			"db:migrate": "drizzle-kit migrate",
			"db:push": "drizzle-kit push",
			"db:studio": "drizzle-kit studio",
		}),
		envEntries(filePath("apps/web/.env"), "Database", ["DATABASE_URL="]),
		envEntries(filePath("apps/web/.env.example"), "Database", [
			"DATABASE_URL=",
		]),
	],
});

export default drizzle;
