import { Effect, Layer } from "effect";
import { CommandProbe } from "./command";

export const runtimes = {
	node: { displayName: "Node.js", minimumMajor: 22 },
	bun: { displayName: "Bun", minimumMajor: 1 },
	deno: { displayName: "Deno", minimumMajor: 2 },
} as const;

type RuntimeId = keyof typeof runtimes;
export type Runtime = (typeof runtimes)[RuntimeId]["displayName"];

const rtCommandMap = Object.fromEntries(
	Object.entries(runtimes).map(([id, { displayName }]) => [displayName, id]),
) as Record<Runtime, RuntimeId>;

export function runtimeCommand(rt: Runtime): string {
	return rtCommandMap[rt];
}

export const packageManagers = {
	pnpm: { displayName: "pnpm", minimumMajor: 10 },
	npm: { displayName: "npm", minimumMajor: 10 },
	yarn: { displayName: "Yarn", minimumMajor: 1 },
	bun: { displayName: "Bun", minimumMajor: 1 },
} as const;

type PackageManagerId = keyof typeof packageManagers;
export type PackageManager =
	(typeof packageManagers)[PackageManagerId]["displayName"];

const pmCommandMap = Object.fromEntries(
	Object.entries(packageManagers).map(([id, { displayName }]) => [
		displayName,
		id,
	]),
) as Record<PackageManager, PackageManagerId>;

export function packageManagerCommand(pm: PackageManager): string {
	return pmCommandMap[pm];
}

export interface EnvironmentCheck {
	readonly ok: boolean;
	readonly message: string;
}

function detectRuntime(): { id: RuntimeId; version: string } {
	if ("bun" in process.versions && process.versions.bun !== undefined)
		return { id: "bun", version: process.versions.bun };

	if ("deno" in process.versions && process.versions.deno !== undefined)
		return { id: "deno", version: process.versions.deno };

	return { id: "node", version: process.versions.node };
}

function checkCurrentRuntime(): EnvironmentCheck {
	const { id, version } = detectRuntime();
	const { displayName, minimumMajor } = runtimes[id];
	const major = Number(version.split(".")[0]);

	if (major < minimumMajor)
		return {
			ok: false,
			message: `You need ${displayName} ${minimumMajor} or later to forge a project, but you're running v${version}.`,
		};

	return { ok: true, message: `${displayName} v${version}` };
}

function buildPackageManagerCheck(
	pm: PackageManager,
	version: string,
): EnvironmentCheck {
	const cmd = pmCommandMap[pm];
	const { displayName, minimumMajor } = packageManagers[cmd];

	const major = Number(version.split(".")[0]);
	if (major < minimumMajor)
		return {
			ok: false,
			message: `You need ${displayName} v${minimumMajor} or later to forge a project, but you're running v${version}.`,
		};

	return { ok: true, message: `${displayName} v${version}` };
}

export class Environment extends Effect.Service<Environment>()("Environment", {
	accessors: true,
	effect: Effect.succeed({
		checkRuntime: () => Effect.sync(checkCurrentRuntime),
		checkPackageManager: (pm: PackageManager) => {
			const displayName = packageManagers[pmCommandMap[pm]].displayName;

			return CommandProbe.readVersion(packageManagerCommand(pm)).pipe(
				Effect.map((version) => buildPackageManagerCheck(pm, version)),
				Effect.catchTag("CommandProbeError", () =>
					Effect.succeed<EnvironmentCheck>({
						ok: false,
						message: `You don't have ${displayName} installed, please install it and try again.`,
					}),
				),
			);
		},
		readPackageManagerVersion: (pm: PackageManager) =>
			CommandProbe.readVersion(packageManagerCommand(pm)),
	}),
}) {}

const environmentLayer = Layer.mergeAll(
	CommandProbe.Default,
	Environment.Default,
);

export function checkRuntime(): EnvironmentCheck {
	return Effect.runSync(
		Environment.checkRuntime().pipe(Effect.provide(environmentLayer)),
	);
}

export function checkPackageManager(pm: PackageManager): EnvironmentCheck {
	return Effect.runSync(
		Environment.checkPackageManager(pm).pipe(Effect.provide(environmentLayer)),
	);
}
