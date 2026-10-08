import type { DiscoveredModule, ModuleId } from "./config";
import type { Lockfile, LockfileArtifact, Manifest } from "./state";

export interface DirectoryMove {
	readonly moduleId: ModuleId;
	readonly from: string;
	readonly to: string;
}

export type RootChanges = ReadonlyMap<
	ModuleId,
	{ readonly from: string; readonly to: string }
>;

export function rootChanges(
	previous: Manifest["modules"],
	next: Manifest["modules"],
): RootChanges {
	return new Map(
		Object.entries(previous).flatMap(([id, record]) => {
			const to = next[id]?.root;
			return record.root !== undefined && to !== undefined && record.root !== to
				? [[id, { from: record.root, to }]]
				: [];
		}),
	);
}

export function relocatePath(path: string, changes: RootChanges): string {
	const change = [...changes.values()]
		.sort((left, right) => right.from.length - left.from.length)
		.find(({ from }) => path === from || path.startsWith(`${from}/`));

	return change === undefined
		? path
		: `${change.to}${path.slice(change.from.length)}`;
}

export function relocateArtifactId(id: string, changes: RootChanges): string {
	const path = artifactFilePath(id);
	return path === undefined
		? id
		: `${id.slice(0, -path.length)}${relocatePath(path, changes)}`;
}

export function artifactModuleId(id: string): string | undefined {
	return /^module:([^:]+):/.exec(id)?.[1];
}

export function artifactFilePath(id: string): string | undefined {
	return /^module:[^:]+:file:(.+)$/.exec(id)?.[1];
}

export function relocateLockfile(
	lockfile: Lockfile,
	changes: RootChanges,
): Lockfile {
	const artifacts: Record<string, LockfileArtifact> = {};
	const paths = new Set<string>();
	for (const [id, artifact] of Object.entries(lockfile.artifacts)) {
		const relocatedId = relocateArtifactId(id, changes);
		const path = relocatePath(artifact.path, changes);
		if (Object.hasOwn(artifacts, relocatedId) || paths.has(path))
			throw new Error(`Relocation Collision: ${path}`);

		artifacts[relocatedId] = { ...artifact, path };
		paths.add(path);
	}

	return { ...lockfile, artifacts };
}

export function retainedModuleArtifacts(
	lockfile: Lockfile,
	modules: Manifest["modules"],
): Lockfile {
	return {
		...lockfile,
		artifacts: Object.fromEntries(
			Object.entries(lockfile.artifacts).filter(([id]) => {
				const moduleId = artifactModuleId(id);
				return moduleId === undefined || Object.hasOwn(modules, moduleId);
			}),
		),
	};
}

export function previousLockfileAtNextRoots(
	lockfile: Lockfile,
	previous: Manifest["modules"],
	next: Manifest["modules"],
): Lockfile {
	const retained = relocateLockfile(
		retainedModuleArtifacts(lockfile, next),
		rootChanges(previous, next),
	);

	const departed = Object.entries(lockfile.artifacts).filter(([id]) => {
		const moduleId = artifactModuleId(id);
		return moduleId !== undefined && !Object.hasOwn(next, moduleId);
	});

	return {
		...retained,
		artifacts: { ...Object.fromEntries(departed), ...retained.artifacts },
	};
}

export function moveModules(
	modules: ReadonlyArray<DiscoveredModule>,
	moves: ReadonlyArray<DirectoryMove>,
): ReadonlyArray<DiscoveredModule> {
	const changes = new Map(moves.map((move) => [move.moduleId, move]));

	return modules.map((module) => {
		const root = relocatePath(module.root, changes);
		return root === module.root ? module : { ...module, root };
	});
}

export function sourcePath(
	path: string,
	pending: ReadonlyArray<DirectoryMove>,
): string {
	return relocatePath(
		path,
		new Map(
			pending.map((move) => [move.moduleId, { from: move.to, to: move.from }]),
		),
	);
}

export function relocateInstalls(
	installs: Manifest["installs"],
	changes: RootChanges,
): Manifest["installs"] {
	return installs.map((install) => ({
		...install,
		...(install.versions === undefined
			? {}
			: {
					versions: install.versions.map((version) => ({
						...version,
						root: relocatePath(version.root, changes),
					})),
				}),
	}));
}
