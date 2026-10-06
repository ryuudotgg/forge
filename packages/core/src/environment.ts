import { join } from "node:path";
import { Context, Effect, FileSystem, Layer, Option } from "effect";
import { CommandProbe } from "./command";
import { type DependencyFormat, defaultDependencyFormat } from "./operations";

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
	yarn: { displayName: "Yarn", minimumMajor: 4 },
	bun: { displayName: "Bun", minimumMajor: 1 },
} as const;

export type PackageManagerId = keyof typeof packageManagers;
export type PackageManager =
	(typeof packageManagers)[PackageManagerId]["displayName"];

const pmCommandMap = Object.fromEntries(
	Object.entries(packageManagers).map(([id, { displayName }]) => [
		displayName,
		id,
	]),
) as Record<PackageManager, PackageManagerId>;

export function packageManagerCommand(pm: PackageManager): PackageManagerId {
	return pmCommandMap[pm];
}

const packageManagerAddDevArgs = {
	pnpm: ["add", "-D", "-w"],
	npm: ["install", "-D"],
	yarn: ["add", "-D"],
	bun: ["add", "-d"],
} satisfies Record<PackageManagerId, ReadonlyArray<string>>;

const packageManagerRemoveArgs = {
	pnpm: ["remove"],
	npm: ["uninstall"],
	yarn: ["remove"],
	bun: ["remove"],
} satisfies Record<PackageManagerId, ReadonlyArray<string>>;

export function packageManagerAddDevCommand(
	pm: PackageManager,
	packageId: string,
) {
	const command = packageManagerCommand(pm);
	return {
		args: [...packageManagerAddDevArgs[command], packageId],
		command,
	};
}

export function packageManagerInstallCommand(pm: PackageManager) {
	const command = packageManagerCommand(pm);
	const args = {
		pnpm: ["install", "--no-frozen-lockfile"],
		npm: ["install"],
		yarn: ["install", "--no-immutable"],
		bun: ["install"],
	} satisfies Record<PackageManagerId, ReadonlyArray<string>>;

	return { command, args: args[command] };
}

export function packageManagerExecCommand(
	pm: PackageManager,
	bin: string,
	args: ReadonlyArray<string>,
) {
	const command = packageManagerCommand(pm);
	const prefix = {
		pnpm: ["exec"],
		npm: ["exec", "--no", "--"],
		yarn: ["exec"],
		bun: ["x"],
	} satisfies Record<PackageManagerId, ReadonlyArray<string>>;

	return { command, args: [...prefix[command], bin, ...args] };
}

export function packageManagerRemoveCommand(
	pm: PackageManager,
	packageId: string,
) {
	const command = packageManagerCommand(pm);
	return {
		args: [...packageManagerRemoveArgs[command], packageId],
		command,
	};
}

export function packageManagerViewCommand(
	pm: PackageManager,
	packageId: string,
) {
	const command = packageManagerCommand(pm);
	const spec = `${packageId}@latest`;
	const args = {
		pnpm: ["view", spec, "version", "_npmUser.name", "--json"],
		npm: ["view", spec, "version", "_npmUser.name", "--json"],
		yarn: ["npm", "info", spec, "--fields", "version", "--json"],
		bun: ["info", spec, "--json"],
	} satisfies Record<PackageManagerId, ReadonlyArray<string>>;

	return { args: args[command], command };
}

export function isPackageManager(value: unknown): value is PackageManager {
	return Object.values(packageManagers).some((pm) => pm.displayName === value);
}

export function dependencyFormatFor(packageManager: unknown): DependencyFormat {
	if (!isPackageManager(packageManager)) return defaultDependencyFormat;

	const id = pmCommandMap[packageManager];
	return {
		useCatalog: id === "pnpm",
		useWorkspaceProtocol: id !== "npm",
	};
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

function parseMajor(version: string): number | undefined {
	const major = version.match(/^(\d+)(?:\.|$)/)?.[1];
	return major === undefined ? undefined : Number(major);
}

function checkCurrentRuntime(): EnvironmentCheck {
	const { id, version } = detectRuntime();
	const { displayName, minimumMajor } = runtimes[id];
	const major = parseMajor(version);
	if (major === undefined)
		return {
			ok: false,
			message: `We couldn't tell which ${displayName} version you're running.`,
		};

	if (major < minimumMajor)
		return {
			ok: false,
			message: `You need ${displayName} ${minimumMajor} or later to forge a project, but you're running v${version}.`,
		};

	return { ok: true, message: `${displayName} v${version}` };
}

export function buildPackageManagerCheck(
	pm: PackageManager,
	version: string,
): EnvironmentCheck {
	const cmd = pmCommandMap[pm];
	const { displayName, minimumMajor } = packageManagers[cmd];

	const major = parseMajor(version);
	if (major === undefined)
		return {
			ok: false,
			message: `We couldn't tell which ${displayName} version you're running.`,
		};

	if (major < minimumMajor)
		return {
			ok: false,
			message: `You need ${displayName} v${minimumMajor} or later to forge a project, but you're running v${version}.`,
		};

	return { ok: true, message: `${displayName} v${version}` };
}

function pathCandidates(command: string) {
	const windows = process.platform === "win32";
	const directories = (process.env.PATH ?? "")
		.split(windows ? ";" : ":")
		.filter((directory) => directory.length > 0);

	const extensions = windows
		? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
		: [""];

	return directories.flatMap((directory) =>
		extensions.map((extension) => join(directory, `${command}${extension}`)),
	);
}

const isOnPath = Effect.fn("Environment.isOnPath")(function* (command: string) {
	const fs = yield* FileSystem.FileSystem;
	for (const candidate of pathCandidates(command)) {
		const info = yield* fs.stat(candidate).pipe(Effect.option);
		if (
			Option.isSome(info) &&
			info.value.type === "File" &&
			(process.platform === "win32" || (info.value.mode & 0o111) !== 0)
		)
			return true;
	}

	return false;
});

const makeEnvironment = Effect.succeed({
	checkRuntime: Effect.sync(checkCurrentRuntime),
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
	checkPackageManagerInstalled: (pm: PackageManager) => {
		const displayName = packageManagers[pmCommandMap[pm]].displayName;
		return isOnPath(packageManagerCommand(pm)).pipe(
			Effect.map(
				(found): EnvironmentCheck =>
					found
						? { ok: true, message: `${displayName} is installed.` }
						: {
								ok: false,
								message: `You don't have ${displayName} installed, please install it and try again.`,
							},
			),
		);
	},
});

type EnvironmentService = Effect.Success<typeof makeEnvironment>;

export class Environment extends Context.Service<
	Environment,
	EnvironmentService
>()("Environment") {
	static readonly Default = Layer.effect(Environment, makeEnvironment);
	static readonly checkRuntime = Environment.use(
		(service) => service.checkRuntime,
	);
	static readonly checkPackageManager = (
		...args: Parameters<EnvironmentService["checkPackageManager"]>
	) => Environment.use((service) => service.checkPackageManager(...args));
	static readonly readPackageManagerVersion = (
		...args: Parameters<EnvironmentService["readPackageManagerVersion"]>
	) => Environment.use((service) => service.readPackageManagerVersion(...args));
}

const environmentLayer = Environment.Default;
export function checkRuntime(): EnvironmentCheck {
	return Effect.runSync(
		Environment.checkRuntime.pipe(Effect.provide(environmentLayer)),
	);
}

export function checkPackageManager(pm: PackageManager) {
	return Environment.checkPackageManager(pm);
}

export function checkPackageManagerInstalled(pm: PackageManager) {
	return Environment.use((service) => service.checkPackageManagerInstalled(pm));
}
