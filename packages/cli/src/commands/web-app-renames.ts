import { basename, dirname, join } from "node:path";
import {
	type DirectoryMove,
	type DiscoveredModule,
	type Manifest,
	type ModuleId,
	moveModules,
	packageManagerInstallCommand,
	type ReferenceHit,
	type ReferenceToken,
	referenceHits,
	trackedReferenceHits,
	workingTreeStatus,
} from "@ryuugg/core";
import {
	builtins,
	type ForgeConfig,
	reservedWebAppNames,
	type WebAppInstance,
	webAppInstances,
	webAppNamesIssue,
	webFrameworks,
} from "@ryuugg/generators";
import { Effect, FileSystem } from "effect";
import { webAppConfigShapeIssue } from "../config/schema";
import {
	firstPartyAddonIds,
	webAppNameRuleIssue,
} from "../steps/platforms/web-apps";
import { listAnd } from "../utils/list";

export interface WebAppRename {
	readonly moduleId: ModuleId;
	readonly previous: {
		readonly root: string;
		readonly packageName: string;
	};
	readonly next: {
		readonly root: string;
		readonly packageName: string;
	};
}

export interface RenameRefusal {
	readonly message: string;
}

export function webAppRenameNameIssue(
	renames: ReadonlyArray<WebAppRename>,
): string | undefined {
	const addonIds = firstPartyAddonIds();
	for (const rename of renames) {
		const name = rename.next.root.slice("apps/".length);
		if (name === "") return `Give the app at ${rename.previous.root} a name.`;
		if (addonIds.includes(name))
			return `${name} is an addon id, so pick another name for this web app.`;

		if (new Set<string>(reservedWebAppNames).has(name))
			return `${name} is reserved, so pick another name for this web app.`;

		const issue = webAppNameRuleIssue(name);
		if (issue !== undefined) return issue;
	}
}

function matchesInstance(
	module: DiscoveredModule,
	instance: WebAppInstance,
): boolean {
	const template = builtins.templates.find(
		(entry) => entry.framework === instance.framework,
	);

	return (
		template !== undefined &&
		module.type === "app" &&
		module.framework === instance.framework &&
		module.template.id === template.id &&
		module.template.version === template.version &&
		(module.role !== "primary" || instance.primary)
	);
}

export function pairWebAppRenames(
	config: ForgeConfig,
	modules: ReadonlyArray<DiscoveredModule>,
	records: Manifest["modules"],
): ReadonlyArray<WebAppRename> | RenameRefusal {
	const shapeIssue = webAppConfigShapeIssue(config) ?? webAppNamesIssue(config);
	if (shapeIssue !== undefined) return { message: shapeIssue };

	const configuredInstances = webAppInstances(config);
	const instances = new Set(configuredInstances);
	const remaining = new Set(
		modules.filter(
			(module) =>
				module.type === "app" &&
				webFrameworks.normalize(module.framework) === module.framework &&
				Object.hasOwn(records, module.id),
		),
	);

	const renames: WebAppRename[] = [];
	const claim = (
		instance: WebAppInstance,
		module: DiscoveredModule,
		rename: boolean,
	) => {
		instances.delete(instance);
		remaining.delete(module);
		if (!rename) return;

		renames.push({
			moduleId: module.id,
			previous: {
				root: module.root,
				packageName:
					module.packageName ??
					`@${config.slug ?? "my-app"}/${basename(module.root)}`,
			},
			next: {
				root: instance.root,
				packageName: instance.packageName,
			},
		});
	};

	for (const match of [
		(module: DiscoveredModule, instance: WebAppInstance) =>
			module.root === instance.root,
		(module: DiscoveredModule, instance: WebAppInstance) =>
			module.packageName === instance.packageName,
	])
		for (const instance of instances) {
			const module = [...remaining].find(
				(module) =>
					matchesInstance(module, instance) && match(module, instance),
			);

			if (module !== undefined) claim(instance, module, false);
		}

	for (const module of remaining) {
		const name = basename(module.root);
		if (
			module.root !== `apps/${name}` ||
			(module.packageName !== undefined &&
				!module.packageName.endsWith(`/${name}`))
		)
			remaining.delete(module);
	}

	for (const instance of instances) {
		if (!instance.primary) continue;

		const candidates = [...remaining].filter(
			(module) =>
				matchesInstance(module, instance) &&
				module.type === "app" &&
				module.role === "primary",
		);

		const primary = candidates.length === 1 ? candidates[0] : undefined;
		if (primary !== undefined) claim(instance, primary, true);
	}

	for (const instance of instances) {
		const candidates = [...remaining].filter((module) =>
			matchesInstance(module, instance),
		);

		if (candidates.length === 0) continue;

		const peers = [...instances].filter(
			(peer) => peer.framework === instance.framework,
		);

		const module = candidates.length === 1 ? candidates[0] : undefined;
		if (peers.length === 1 && module !== undefined) {
			claim(instance, module, true);
			continue;
		}

		return {
			message: `We can't tell which apps to rename from ${listAnd.format(candidates.map((entry) => entry.root))} to ${listAnd.format(peers.map((entry) => entry.root))}. Rename one app at a time.`,
		};
	}

	for (const rename of renames) {
		const reused = configuredInstances.find(
			(instance) =>
				instance.root === rename.previous.root ||
				instance.root.startsWith(`${rename.previous.root}/`),
		);

		if (reused !== undefined)
			return {
				message: `Rename ${rename.previous.root} first, then add the new ${reused.key} app.`,
			};
	}

	return renames;
}

export function directoryMoves(
	renames: ReadonlyArray<WebAppRename>,
): DirectoryMove[] {
	return renames.map((rename) => ({
		moduleId: rename.moduleId,
		from: rename.previous.root,
		to: rename.next.root,
	}));
}

export function pendingWebAppRenameIssue(
	config: ForgeConfig,
	modules: ReadonlyArray<DiscoveredModule>,
	records: Manifest["modules"],
): string | undefined {
	const paired = pairWebAppRenames(config, modules, records);
	if ("message" in paired) return paired.message;
	if (paired.length === 0) return undefined;

	return `Run forge update first to move ${listAnd.format(paired.map((rename) => `${rename.previous.root} to ${rename.next.root}`))}.`;
}

export function checkWebAppRenames(
	root: string,
	renames: ReadonlyArray<WebAppRename>,
	config?: ForgeConfig,
	modules: ReadonlyArray<DiscoveredModule> = [],
) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		for (const rename of renames) {
			const target = join(root, rename.next.root);
			const entries = yield* fs
				.readDirectory(dirname(target))
				.pipe(
					Effect.catchTag("PlatformError", (cause) =>
						cause.reason._tag === "NotFound"
							? Effect.succeed<string[]>([])
							: Effect.fail(cause),
					),
				);

			if (entries.includes(basename(target)))
				return `${rename.next.root} already exists. Pick another name for this web app.`;
		}

		if (yield* fs.exists(join(root, ".forge/state.json"))) return undefined;

		const status = yield* workingTreeStatus(root, [
			".forge/manifest.json",
			".forge/state.json",
			".forge/declined",
		]);

		if (status._tag === "Untracked")
			return "We can't rename web apps until Git tracks this project. Commit your project first.";

		if (status._tag === "Dirty") {
			const paths = status.paths ?? [];
			const missingRoots =
				config === undefined
					? []
					: webAppInstances(config)
							.filter(
								(instance) =>
									!modules.some((module) => module.root === instance.root),
							)
							.map((instance) => instance.root);

			const moved = paths.some((path) =>
				missingRoots.some(
					(root) => path === root || path.startsWith(`${root}/`),
				),
			);

			const namedPaths = listAnd.format(paths.slice(0, 3));
			const more = paths.length > 3 ? ` and ${paths.length - 3} more` : "";
			return `We can't rename web apps while you have uncommitted changes in ${namedPaths}${more}. ${moved ? "Commit the move first." : "Commit or stash them first."}`;
		}
	});
}

export function renameReferenceTokens(
	renames: ReadonlyArray<WebAppRename>,
): ReferenceToken[] {
	return renames.flatMap((rename) => [
		{ previous: rename.previous.root, next: rename.next.root },
		{ previous: rename.previous.packageName, next: rename.next.packageName },
	]);
}

export function scanRenameReferences(
	root: string,
	renames: ReadonlyArray<WebAppRename>,
	modules: ReadonlyArray<DiscoveredModule>,
) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const tokens = renameReferenceTokens(renames);
		const tracked = yield* trackedReferenceHits(
			root,
			tokens,
			directoryMoves(renames),
		);

		const envHits: ReferenceHit[] = [];
		const roots = new Set([
			".",
			...modules
				.filter((module) => module.type === "app")
				.map((module) => module.root),
		]);

		for (const directory of roots) {
			const names = yield* fs
				.readDirectory(join(root, directory))
				.pipe(
					Effect.catchTag("PlatformError", (cause) =>
						cause.reason._tag === "NotFound"
							? Effect.succeed<string[]>([])
							: Effect.fail(cause),
					),
				);

			for (const name of names.filter(
				(name) =>
					name === ".env" ||
					(name.startsWith(".env.") && !name.endsWith(".example")),
			)) {
				const path = directory === "." ? name : `${directory}/${name}`;
				const content = yield* fs.readFileString(join(root, path));
				envHits.push(
					...content
						.split("\n")
						.flatMap((text, index) =>
							referenceHits(path, index + 1, text, tokens, true),
						),
				);
			}
		}

		return [
			...tracked.filter(
				(hit) =>
					!envHits.some(
						(env) =>
							env.path === hit.path &&
							env.line === hit.line &&
							env.token === hit.token,
					),
			),
			...envHits,
		];
	});
}

export function renameReport(
	renames: ReadonlyArray<WebAppRename>,
	before: ReadonlyArray<ReferenceHit>,
	after: ReadonlyArray<ReferenceHit>,
	existingPaths: ReadonlySet<string>,
): { readonly info: string[]; readonly warnings: string[] } {
	const moves = directoryMoves(renames);
	const updated = [
		...new Set(
			before
				.filter(
					(hit) =>
						!hit.env &&
						existingPaths.has(hit.path) &&
						!after.some((remaining) => remaining.path === hit.path) &&
						!moves.some(
							(move) =>
								hit.path.startsWith(`${move.from}/`) ||
								hit.path.startsWith(`${move.to}/`),
						),
				)
				.map((hit) => hit.path),
		),
	];

	const info = [
		`We moved ${listAnd.format(renames.map((rename) => `${rename.previous.root} to ${rename.next.root}`))}.`,
	];

	if (updated.length > 0)
		info.push(`We updated the app references in ${listAnd.format(updated)}.`);

	return {
		info,
		warnings: after.map((hit) =>
			hit.env
				? `Line ${hit.line} of ${hit.path} still names ${hit.token}. Change it to ${hit.replacement}.`
				: `${hit.path} still names ${hit.token} on line ${hit.line}. Change it to ${hit.replacement}.`,
		),
	};
}

export function renameInstallHint(root: string, config: ForgeConfig) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const installed = (yield* Effect.forEach(
			[
				"pnpm-lock.yaml",
				"package-lock.json",
				"yarn.lock",
				"bun.lock",
				"bun.lockb",
				"node_modules",
			],
			(path) => fs.exists(join(root, path)),
		)).some(Boolean);

		const install = packageManagerInstallCommand(
			config.packageManager ?? "pnpm",
		);

		return installed
			? `Run ${[install.command, ...install.args].join(" ")} to refresh your workspace dependencies.`
			: undefined;
	});
}

export function renamedModules(
	modules: ReadonlyArray<DiscoveredModule>,
	renames: ReadonlyArray<WebAppRename>,
): ReadonlyArray<DiscoveredModule> {
	return moveModules(modules, directoryMoves(renames)).map((module) => {
		const rename = renames.find((rename) => rename.moduleId === module.id);
		return rename === undefined
			? module
			: { ...module, packageName: rename.next.packageName };
	});
}
