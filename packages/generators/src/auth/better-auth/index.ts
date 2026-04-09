import {
	defineAddon,
	leafTextFile,
	selectedModuleTarget,
	surfaceDependencies,
	surfaceLines,
	surfaceText,
} from "@ryuujs/core";
import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { readTemplate } from "../../template";

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
		leafTextFile(
			selectedModuleTarget(),
			"app/api/auth/[...all]/route.ts",
			readTemplate("auth/better-auth/app/api/auth/[...all]/route.ts"),
		),
		leafTextFile(
			selectedModuleTarget(),
			"src/db/auth-schema.ts",
			readTemplate("auth/better-auth/src/db/auth-schema.ts"),
		),
		surfaceText(
			selectedModuleTarget(),
			"authClient",
			readTemplate("auth/better-auth/src/lib/auth-client.ts"),
		),
		surfaceText(
			selectedModuleTarget(),
			"auth",
			readTemplate("auth/better-auth/src/lib/auth.ts"),
		),
		surfaceDependencies(selectedModuleTarget(), "packageJson", [
			{ ...deps.betterAuth, type: "dependencies" },
		]),
		surfaceLines(
			selectedModuleTarget(),
			"env",
			["BETTER_AUTH_SECRET=", "BETTER_AUTH_URL=http://localhost:3000"],
			{ section: "Auth" },
		),
		surfaceLines(
			selectedModuleTarget(),
			"envExample",
			["BETTER_AUTH_SECRET=", "BETTER_AUTH_URL=http://localhost:3000"],
			{ section: "Auth" },
		),
	],
});

export default betterAuth;
