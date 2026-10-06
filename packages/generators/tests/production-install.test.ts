import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

interface PackageJson {
	readonly dependencies: Readonly<Record<string, string>>;
	readonly scripts: Readonly<Record<string, string>>;
}

const packagesByBin: Readonly<Record<string, string>> = {
	dotenv: "dotenv-cli",
	lefthook: "lefthook",
	next: "next",
	prisma: "prisma",
	"react-router": "@react-router/dev",
	"react-router-serve": "@react-router/serve",
	srvx: "srvx",
	tsr: "@tanstack/router-cli",
};

function stringRecord(value: unknown): Readonly<Record<string, string>> {
	if (typeof value !== "object" || value === null) return {};

	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function packageJson(content: string): PackageJson {
	const parsed: unknown = JSON.parse(content);
	if (typeof parsed !== "object" || parsed === null)
		throw new Error("Invalid Package Json: Expected an object");

	return {
		dependencies:
			"dependencies" in parsed ? stringRecord(parsed.dependencies) : {},
		scripts: "scripts" in parsed ? stringRecord(parsed.scripts) : {},
	};
}

function scriptTools(
	command: string,
	manifest: PackageJson,
	path: string,
	visited: readonly string[] = [],
): string[] {
	return command.split(/&&|\|\||;/).flatMap((part) => {
		const words = part.trim().split(/\s+/).filter(Boolean);
		const bin = words[0];
		if (bin === undefined || bin === "node" || bin === "exit") return [];

		if (["pnpm", "npm", "yarn", "bun"].includes(bin)) {
			const scriptIndex = words[1] === "run" ? 2 : 1;
			const script = words[scriptIndex];
			const body = script === undefined ? undefined : manifest.scripts[script];
			if (script === undefined || body === undefined)
				throw new Error(`Missing Script: ${path}: ${part}`);

			if (visited.includes(script))
				throw new Error(`Recursive Script: ${path}: ${script}`);

			const args = words.slice(scriptIndex + 1);
			if (args[0] === "--") args.shift();

			return scriptTools(`${body} ${args.join(" ")}`, manifest, path, [
				...visited,
				script,
			]);
		}

		const dependency = packagesByBin[bin];
		if (dependency === undefined)
			throw new Error(`Unknown Script Tool: ${path}: ${bin}`);

		if (bin !== "dotenv") return [dependency];

		const separator = words.indexOf("--");
		if (separator === -1)
			throw new Error(`Missing Dotenv Command: ${path}: ${part}`);

		return [
			dependency,
			...scriptTools(
				words.slice(separator + 1).join(" "),
				manifest,
				path,
				visited,
			),
		];
	});
}

const baseConfig: ForgeConfig = {
	slug: "acme",
	web: "tanstack-router",
	backend: "hono",
	packageManager: "pnpm",
	linter: "biome",
	style: "tailwind",
	rpc: "trpc",
};

const configs: ReadonlyArray<{
	readonly name: string;
	readonly config: ForgeConfig;
}> = [
	{ name: "Hono", config: baseConfig },
	{ name: "Express", config: { ...baseConfig, backend: "express" } },
	{ name: "Fastify", config: { ...baseConfig, backend: "fastify" } },
	{
		name: "Next.js self host",
		config: { ...baseConfig, web: "nextjs", backend: "self" },
	},
	{ name: "Worker", config: { ...baseConfig, addons: ["worker"] } },
	{ name: "TanStack Router", config: baseConfig },
	{
		name: "TanStack Start",
		config: { ...baseConfig, web: "tanstack-start", backend: "self" },
	},
	{
		name: "React Router",
		config: { ...baseConfig, web: "react-router", backend: "self" },
	},
	{
		name: "Prisma",
		config: {
			...baseConfig,
			web: "nextjs",
			backend: "self",
			authentication: "better-auth",
			authMethods: ["email-password"],
			orm: "prisma",
			database: "sqlite",
		},
	},
	{ name: "Lefthook", config: { ...baseConfig, addons: ["lefthook"] } },
];

describe("production install scripts", () => {
	it.each(configs)(
		"keeps $name runnable without dev tools",
		async ({ config }) => {
			const plan = await plannedProject(config);
			const manifests = plan.writes.filter(
				(write) =>
					write.path === "package.json" || write.path.endsWith("/package.json"),
			);

			expect(manifests.length).toBeGreaterThan(0);

			for (const write of manifests) {
				const manifest = packageJson(write.content);
				for (const script of ["start", "postinstall", "prepare"]) {
					const command = manifest.scripts[script];
					if (command === undefined) continue;
					if (script !== "start" && command.endsWith("|| exit 0")) continue;

					for (const dependency of scriptTools(command, manifest, write.path, [
						script,
					]))
						expect(
							manifest.dependencies,
							`${write.path}: ${script}: ${dependency}`,
						).toHaveProperty(dependency);
				}
			}
		},
	);

	it.each([
		"pnpm with-env",
		"pnpm run with-env",
		"npm run with-env --",
		"yarn with-env",
		"bun run with-env",
	])("follows arguments through %s", (command) => {
		const manifest: PackageJson = {
			dependencies: {},
			scripts: { "with-env": "dotenv -e ../../.env --" },
		};

		expect(
			scriptTools(`${command} next start`, manifest, "package.json"),
		).toEqual(["dotenv-cli", "next"]);
	});

	it("rejects unknown tools instead of skipping them", () => {
		expect(() =>
			scriptTools(
				"unknown-tool start",
				{ dependencies: {}, scripts: {} },
				"apps/web/package.json",
			),
		).toThrow("Unknown Script Tool: apps/web/package.json: unknown-tool");
	});
});
