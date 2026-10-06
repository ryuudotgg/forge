import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

interface PackageJson {
	readonly path: string;
	readonly name: string | undefined;
	readonly dependencies: Readonly<Record<string, string>>;
	readonly devDependencies: Readonly<Record<string, string>>;
	readonly scripts: Readonly<Record<string, string>>;
}

interface Workspace {
	readonly byName: ReadonlyMap<string, PackageJson>;
	readonly byDirectory: ReadonlyMap<string, PackageJson>;
}

interface ScriptTool {
	readonly dependency: string;
	readonly manifest: PackageJson;
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

const presenceGuard =
	/^node -e "try\{require\.resolve\('([^']+)\/package\.json'(?:,\{paths:\['([^']+)'\]\})?\);process\.exit\(1\)\}catch\{\}" \|\| (.+)$/;

function stringRecord(value: unknown): Readonly<Record<string, string>> {
	if (typeof value !== "object" || value === null) return {};

	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function packageJson(path: string, content: string): PackageJson {
	const parsed: unknown = JSON.parse(content);
	if (typeof parsed !== "object" || parsed === null)
		throw new Error(`Invalid Package Json: ${path}`);

	return {
		path,
		name:
			"name" in parsed && typeof parsed.name === "string"
				? parsed.name
				: undefined,
		dependencies:
			"dependencies" in parsed ? stringRecord(parsed.dependencies) : {},
		devDependencies:
			"devDependencies" in parsed ? stringRecord(parsed.devDependencies) : {},
		scripts: "scripts" in parsed ? stringRecord(parsed.scripts) : {},
	};
}

function workspaceOf(manifests: readonly PackageJson[]): Workspace {
	return {
		byName: new Map(
			manifests.flatMap((manifest) =>
				manifest.name === undefined ? [] : [[manifest.name, manifest]],
			),
		),
		byDirectory: new Map(
			manifests.map((manifest) => [dirname(manifest.path), manifest]),
		),
	};
}

function scriptTarget(
	words: readonly string[],
	manifest: PackageJson,
	workspace: Workspace,
) {
	if (words[0] === "pnpm" && words[1] === "--filter") {
		const target =
			words[2] === undefined ? undefined : workspace.byName.get(words[2]);
		if (target === undefined || words[3] !== "run")
			throw new Error(`Unknown Filter: ${manifest.path}: ${words.join(" ")}`);

		return { manifest: target, scriptIndex: 4 };
	}

	return { manifest, scriptIndex: words[1] === "run" ? 2 : 1 };
}

function scriptTools(
	command: string,
	manifest: PackageJson,
	workspace: Workspace,
	visited: readonly string[] = [],
): ScriptTool[] {
	return command.split(/&&|\|\||;/).flatMap((part) => {
		const words = part.trim().split(/\s+/).filter(Boolean);
		const bin = words[0];
		if (bin === undefined || bin === "node") return [];

		if (["pnpm", "npm", "yarn", "bun"].includes(bin)) {
			const target = scriptTarget(words, manifest, workspace);
			const script = words[target.scriptIndex];
			const body =
				script === undefined ? undefined : target.manifest.scripts[script];

			if (script === undefined || body === undefined)
				throw new Error(`Missing Script: ${manifest.path}: ${part}`);

			const key = `${target.manifest.path}#${script}`;
			if (visited.includes(key))
				throw new Error(`Recursive Script: ${manifest.path}: ${script}`);

			const args = words.slice(target.scriptIndex + 1);
			if (args[0] === "--") args.shift();

			return scriptTools(
				`${body} ${args.join(" ")}`,
				target.manifest,
				workspace,
				[...visited, key],
			);
		}

		const dependency = packagesByBin[bin];
		if (dependency === undefined)
			throw new Error(`Unknown Script Tool: ${manifest.path}: ${bin}`);

		if (bin !== "dotenv") return [{ dependency, manifest }];

		const separator = words.indexOf("--");
		if (separator === -1)
			throw new Error(`Missing Dotenv Command: ${manifest.path}: ${part}`);

		return [
			{ dependency, manifest },
			...scriptTools(
				words.slice(separator + 1).join(" "),
				manifest,
				workspace,
				visited,
			),
		];
	});
}

function guardedHook(
	command: string,
	manifest: PackageJson,
	workspace: Workspace,
) {
	const match = presenceGuard.exec(command);
	if (match === null) return { guard: undefined, command };

	const [, tool, from, guarded] = match;
	if (tool === undefined || guarded === undefined)
		throw new Error(`Invalid Install Hook: ${manifest.path}: ${command}`);

	const base = dirname(manifest.path);
	const directory =
		from === undefined ? base : base === "." ? from : `${base}/${from}`;

	const resolvesFrom = workspace.byDirectory.get(directory);
	if (resolvesFrom === undefined)
		throw new Error(`Missing Guard Package: ${manifest.path}: ${directory}`);

	return { guard: { tool, resolvesFrom }, command: guarded };
}

function runtimeGaps(
	command: string,
	manifest: PackageJson,
	workspace: Workspace,
	guardedTool?: string,
) {
	return scriptTools(command, manifest, workspace)
		.filter(
			(tool) =>
				tool.dependency !== guardedTool &&
				!(tool.dependency in tool.manifest.dependencies),
		)
		.map((tool) => `${tool.manifest.path}: ${tool.dependency}`);
}

function productionInstallGaps(manifests: readonly PackageJson[]) {
	const workspace = workspaceOf(manifests);

	return manifests.flatMap((manifest) => {
		const start = manifest.scripts.start;
		const startGaps =
			start === undefined
				? []
				: runtimeGaps(start, manifest, workspace).map((gap) => `start: ${gap}`);

		const hookGaps = ["postinstall", "prepare"].flatMap((hook) => {
			const script = manifest.scripts[hook];
			if (script === undefined) return [];

			const { guard, command } = guardedHook(script, manifest, workspace);
			const unresolvedGuard =
				guard === undefined ||
				guard.tool in guard.resolvesFrom.dependencies ||
				guard.tool in guard.resolvesFrom.devDependencies
					? []
					: [`${hook}: ${manifest.path}: guard ${guard?.tool} is not declared`];

			return [
				...unresolvedGuard,
				...runtimeGaps(command, manifest, workspace, guard?.tool).map(
					(gap) => `${hook}: ${gap}`,
				),
			];
		});

		return [...startGaps, ...hookGaps];
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
	{ name: "TanStack Router", config: { ...baseConfig, backend: "express" } },
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

async function plannedManifests(config: ForgeConfig) {
	const plan = await plannedProject(config);
	return plan.writes
		.filter(
			(write) =>
				write.path === "package.json" || write.path.endsWith("/package.json"),
		)
		.map((write) => packageJson(write.path, write.content));
}

describe("production install scripts", () => {
	it.each(configs)(
		"keeps $name runnable without dev tools",
		async ({ config }) => {
			const manifests = await plannedManifests(config);
			expect(manifests.length).toBeGreaterThan(0);
			expect(productionInstallGaps(manifests)).toEqual([]);
		},
	);

	it("requires the Prisma guard to resolve from the db package", async () => {
		const manifests = await plannedManifests({
			...baseConfig,
			web: "nextjs",
			backend: "self",
			orm: "prisma",
			database: "sqlite",
		});

		const unguardedRoot = manifests.map((manifest) =>
			manifest.path === "package.json"
				? {
						...manifest,
						scripts: {
							...manifest.scripts,
							postinstall:
								manifest.scripts.postinstall?.replace(
									",{paths:['packages/db']}",
									"",
								) ?? "",
						},
					}
				: manifest,
		);

		expect(productionInstallGaps(unguardedRoot)).toEqual([
			"postinstall: package.json: guard prisma is not declared",
		]);
	});

	it.each([
		"pnpm with-env",
		"pnpm run with-env",
		"npm run with-env --",
		"yarn with-env",
		"bun run with-env",
	])("follows arguments through %s", (command) => {
		const manifest = packageJson(
			"package.json",
			JSON.stringify({ scripts: { "with-env": "dotenv -e ../../.env --" } }),
		);

		expect(
			scriptTools(
				`${command} next start`,
				manifest,
				workspaceOf([manifest]),
			).map((tool) => tool.dependency),
		).toEqual(["dotenv-cli", "next"]);
	});

	it("rejects unknown tools instead of skipping them", () => {
		const manifest = packageJson("apps/web/package.json", "{}");

		expect(() =>
			scriptTools("unknown-tool start", manifest, workspaceOf([manifest])),
		).toThrow("Unknown Script Tool: apps/web/package.json: unknown-tool");
	});
});
