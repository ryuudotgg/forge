import { defineAddon, dependencies, envEntries, filePath } from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { templateFiles } from "../../template";

const betterAuth = defineAddon<ForgeConfig, "better-auth", "nextjs">({
	id: "better-auth",
	name: "Better Auth",
	version: "0.1.0",
	category: "auth",
	exclusive: true,
	dependencies: [
		{ id: "nextjs/base", type: "template" },
		{ id: "drizzle", type: "addon" },
	],
	targetMode: "single",
	compatibility: {
		app: {
			frameworks: ["nextjs"],
			requiredSlots: ["auth", "authClient"],
		},
	},
	when: (config) => config.authentication === "better-auth",
	contribute: () => [
		...templateFiles("auth/better-auth", "apps/web"),
		dependencies(filePath("apps/web/package.json"), [
			{ ...deps.betterAuth, type: "dependencies" },
		]),
		envEntries(filePath("apps/web/.env"), "Auth", [
			"BETTER_AUTH_SECRET=",
			"BETTER_AUTH_URL=http://localhost:3000",
		]),
		envEntries(filePath("apps/web/.env.example"), "Auth", [
			"BETTER_AUTH_SECRET=",
			"BETTER_AUTH_URL=http://localhost:3000",
		]),
	],
});

export default betterAuth;
