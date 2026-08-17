import {
	defineAddon,
	ensureAppModule,
	ensuredModuleTarget,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
} from "@ryuujs/core";
import { type ForgeConfig, hasAddon } from "../config";
import { envFileLine } from "../data/providers";
import { deps } from "../deps";
import { pmRun, resolvePackageManager } from "../pm";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { interpolate, readTemplate } from "../template";

function generateWorkerSecret() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

const worker = defineAddon<ForgeConfig, "worker">({
	id: "worker",
	name: "Worker",
	version: "0.1.0",
	category: "workspace",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	when: (config) => hasAddon(config, "worker"),
	contribute: ({ config }) => {
		const slug = config.slug ?? "my-app";
		const pm = resolvePackageManager(config);

		return [
			ensureAppModule("worker", "apps/worker", {
				framework: "hono",
				template: { id: "worker", version: 1 },
				slots: {},
			}),
			surfaceJson(ensuredModuleTarget("worker"), "packageJson", {
				name: `@${slug}/worker`,
				version: "0.1.0",
				private: true,
				type: "module",
			}),
			surfaceJson(ensuredModuleTarget("worker"), "tsconfig", {
				extends: `@${slug}/tsconfig/hono.json`,
				compilerOptions: {
					paths: { "@/*": ["./src/*"] },
				},
				include: ["src"],
				exclude: ["node_modules", "dist"],
			}),
			surfaceDependencies(ensuredModuleTarget("worker"), "packageJson", [
				{ ...deps.honoNodeServer, type: "dependencies" },
				{ ...deps.hono, type: "dependencies" },
				{ ...deps.t3OssEnvCore, type: "dependencies" },
				{ ...deps.zod, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				{ ...deps.dotenvCli, type: "devDependencies" },
				{ ...deps.tsdown, type: "devDependencies" },
				{ ...deps.tsx, type: "devDependencies" },
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),
			surfaceScripts(ensuredModuleTarget("worker"), "packageJson", {
				build: pmRun(pm, "with-env", "tsdown"),
				dev: pmRun(pm, "with-env", "tsx watch src/index.ts"),
				start: pmRun(pm, "with-env", "node dist/index.js"),
				typecheck: "tsc --noEmit",
				"with-env": "dotenv -e ../../.env --",
			}),
			surfaceLines(
				projectTarget(),
				"rootEnv",
				[envFileLine("WORKER_SECRET", generateWorkerSecret())],
				{ section: "Worker" },
			),
			surfaceLines(
				projectTarget(),
				"rootEnvExample",
				[envFileLine("WORKER_SECRET", "")],
				{ section: "Worker" },
			),
			leafTextFile(
				ensuredModuleTarget("worker"),
				"env.ts",
				readTemplate("worker/env.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("worker"),
				"src/app.ts",
				readTemplate("worker/src/app.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("worker"),
				"src/index.ts",
				readTemplate("worker/src/index.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("worker"),
				"src/run.ts",
				readTemplate("worker/src/run.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("worker"),
				"tsdown.config.ts",
				interpolate(readTemplate("worker/tsdown.config.ts"), { SLUG: slug }),
			),
		];
	},
});

export const workerMetadata = {
	description:
		"Adds a long-running Hono service with a health route, a bearer-authenticated trigger, and graceful drain.",
	experimental: false,
	hidden: false,
	id: "worker",
	keywords: ["hono", "job", "service", "worker"],
	kind: "addon",
	name: "Worker",
	summary: "Add a background worker service.",
} as const satisfies FirstPartyAddonMetadata;

export default worker;
