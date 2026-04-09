import { Effect } from "effect";
import type {
	AppSurfaceName,
	ManagedDependenciesSurfaceContribution,
	ManagedJsonSurfaceContribution,
	ManagedLinesSurfaceContribution,
	ManagedScriptsSurfaceContribution,
	ManagedSurfaceName,
	ManagedTextSurfaceContribution,
	PackageSurfaceName,
	ProjectSurfaceName,
} from "./authoring";
import type {
	AppConfig,
	DiscoveredModule,
	ModuleId,
	PackageConfig,
} from "./config";
import { RendererError } from "./errors";
import { formatJson } from "./format/json";
import { mergeJson } from "./merge/json";
import { appendLines } from "./merge/lines";
import { type Dependency, filePath } from "./operations";
import { sortPackageJson } from "./sort/package-json";

export interface ProjectBucketTarget {
	readonly kind: "project";
}

export interface ModuleBucketTarget {
	readonly kind: "module";
	readonly moduleId: ModuleId;
}

export type RenderBucket = ProjectBucketTarget | ModuleBucketTarget;

export interface SurfaceRenderContribution {
	readonly bucket: RenderBucket;
	readonly contribution:
		| ManagedDependenciesSurfaceContribution
		| ManagedJsonSurfaceContribution
		| ManagedLinesSurfaceContribution
		| ManagedScriptsSurfaceContribution
		| ManagedTextSurfaceContribution;
	readonly definitionId: string;
	readonly order: number;
}

export interface RenderedArtifact {
	readonly bucket: RenderBucket;
	readonly content: string;
	readonly definitionIds: ReadonlyArray<string>;
	readonly key: string;
	readonly kind: "surface";
	readonly path: ReturnType<typeof filePath>;
}

function isProjectSurface(
	surface: ManagedSurfaceName,
): surface is ProjectSurfaceName {
	return [
		"rootPackageJson",
		"rootTsconfig",
		"workspaceConfig",
		"biomeConfig",
		"gitignore",
	].includes(surface);
}

function isAppSurface(surface: ManagedSurfaceName): surface is AppSurfaceName {
	return [
		"layout",
		"page",
		"api",
		"trpc",
		"db",
		"auth",
		"authClient",
		"packageJson",
		"tsconfig",
		"env",
		"envExample",
		"frameworkConfig",
	].includes(surface);
}

function isPackageSurface(
	surface: ManagedSurfaceName,
): surface is PackageSurfaceName {
	return [
		"globalsCss",
		"themeCss",
		"utils",
		"postcssConfig",
		"client",
		"provider",
		"packageJson",
		"tsconfig",
	].includes(surface);
}

function applyDependencies(
	json: Record<string, unknown>,
	dependencies: ReadonlyArray<Dependency>,
): Record<string, unknown> {
	const result = { ...json };

	for (const dep of dependencies) {
		const section = dep.type;
		const existing =
			typeof result[section] === "object" && result[section] !== null
				? (result[section] as Record<string, unknown>)
				: {};

		const value = dep.catalog ? `catalog:${dep.catalog}` : dep.version;
		result[section] = { ...existing, [dep.name]: value };
	}

	return result;
}

function applyScripts(
	json: Record<string, unknown>,
	scripts: Record<string, string>,
): Record<string, unknown> {
	const existing =
		typeof json.scripts === "object" && json.scripts !== null
			? (json.scripts as Record<string, unknown>)
			: {};

	return {
		...json,
		scripts: { ...existing, ...scripts },
	};
}

function resolveProjectSurfacePath(surface: ProjectSurfaceName) {
	switch (surface) {
		case "rootPackageJson":
			return filePath("package.json");
		case "rootTsconfig":
			return filePath("tsconfig.json");
		case "workspaceConfig":
			return filePath("turbo.json");
		case "biomeConfig":
			return filePath("biome.jsonc");
		case "gitignore":
			return filePath(".gitignore");
	}
}

function resolveAppSurfacePath(
	module: DiscoveredModule & AppConfig,
	surface: AppSurfaceName,
) {
	switch (surface) {
		case "packageJson":
			return filePath(`${module.root}/package.json`);
		case "tsconfig":
			return filePath(`${module.root}/tsconfig.json`);
		case "env":
			return filePath(`${module.root}/.env`);
		case "envExample":
			return filePath(`${module.root}/.env.example`);
		case "frameworkConfig":
			if (module.framework === "nextjs")
				return filePath(`${module.root}/next.config.ts`);
			throw new Error("Unsupported Framework Config Surface");
		default: {
			const slotPath = module.slots[surface];
			if (!slotPath) throw new Error("Module Slot Missing");
			return filePath(`${module.root}/${slotPath}`);
		}
	}
}

function resolvePackageSurfacePath(
	module: DiscoveredModule & PackageConfig,
	surface: PackageSurfaceName,
) {
	switch (surface) {
		case "packageJson":
			return filePath(`${module.root}/package.json`);
		case "tsconfig":
			return filePath(`${module.root}/tsconfig.json`);
		default: {
			const slotPath = module.slots[surface];
			if (!slotPath) throw new Error("Module Slot Missing");
			return filePath(`${module.root}/${slotPath}`);
		}
	}
}

function resolveManagedPath(
	surface: ManagedSurfaceName,
	bucket: RenderBucket,
	modulesById: ReadonlyMap<ModuleId, DiscoveredModule>,
) {
	if (bucket.kind === "project") {
		if (!isProjectSurface(surface)) throw new Error("Project Surface Mismatch");
		return resolveProjectSurfacePath(surface);
	}

	const module = modulesById.get(bucket.moduleId);
	if (!module) throw new Error("Target Module Missing");

	if (module.type === "app") {
		if (!isAppSurface(surface)) throw new Error("App Surface Mismatch");
		return resolveAppSurfacePath(module, surface);
	}

	if (!isPackageSurface(surface)) throw new Error("Package Surface Mismatch");
	return resolvePackageSurfacePath(module, surface);
}

function sortInputs(inputs: ReadonlyArray<SurfaceRenderContribution>) {
	return [...inputs].sort((left, right) => left.order - right.order);
}

function renderTextSurface(inputs: ReadonlyArray<SurfaceRenderContribution>) {
	const textInputs = sortInputs(inputs)
		.filter(
			(
				input,
			): input is SurfaceRenderContribution & {
				readonly contribution: ManagedTextSurfaceContribution;
			} => input.contribution._tag === "ManagedTextSurfaceContribution",
		)
		.sort(
			(left, right) =>
				(left.contribution.priority ?? 0) - (right.contribution.priority ?? 0),
		);

	const winner = textInputs[textInputs.length - 1];
	if (!winner) return "";

	const topPriority = winner.contribution.priority ?? 0;
	const conflicts = textInputs.filter(
		(input) => (input.contribution.priority ?? 0) === topPriority,
	);
	if (conflicts.length > 1) throw new Error("Managed Surface Conflict");

	return winner.contribution.content;
}

function renderLinesSurface(inputs: ReadonlyArray<SurfaceRenderContribution>) {
	let content = "";

	for (const input of sortInputs(inputs))
		if (input.contribution._tag === "ManagedLinesSurfaceContribution")
			content = appendLines(
				content,
				input.contribution.lines,
				input.contribution.section,
				input.contribution.position,
			);

	return content;
}

function renderJsonSurface(
	path: ReturnType<typeof filePath>,
	inputs: ReadonlyArray<SurfaceRenderContribution>,
) {
	let json: Record<string, unknown> = {};

	for (const input of sortInputs(inputs)) {
		switch (input.contribution._tag) {
			case "ManagedJsonSurfaceContribution":
				json = mergeJson(
					json,
					input.contribution.value,
					input.contribution.strategy ?? "deep",
				);
				break;
			case "ManagedDependenciesSurfaceContribution":
				json = applyDependencies(json, input.contribution.dependencies);
				break;
			case "ManagedScriptsSurfaceContribution":
				json = applyScripts(json, input.contribution.scripts);
				break;
		}
	}

	if (path.endsWith("package.json")) json = sortPackageJson(json);

	return formatJson(json, { compact: false });
}

function buildKey(bucket: RenderBucket, surface: ManagedSurfaceName) {
	return bucket.kind === "project"
		? `project:${surface}`
		: `module:${bucket.moduleId}:${surface}`;
}

export class Renderer extends Effect.Service<Renderer>()("Renderer", {
	accessors: true,
	effect: Effect.succeed({
		render: (
			inputs: ReadonlyArray<SurfaceRenderContribution>,
			modules: ReadonlyArray<DiscoveredModule>,
		) =>
			Effect.try({
				try: () => {
					const modulesById = new Map(
						modules.map((module) => [module.id, module]),
					);
					const groups = new Map<string, SurfaceRenderContribution[]>();

					for (const input of inputs) {
						const key = buildKey(input.bucket, input.contribution.surface);
						const existing = groups.get(key) ?? [];
						existing.push(input);
						groups.set(key, existing);
					}

					const rendered: RenderedArtifact[] = [];

					for (const entries of groups.values()) {
						const first = entries[0];
						if (!first) continue;

						const path = resolveManagedPath(
							first.contribution.surface,
							first.bucket,
							modulesById,
						);
						const definitionIds = [
							...new Set(entries.map((entry) => entry.definitionId)),
						];

						const tags = new Set(
							entries.map((entry) => entry.contribution._tag),
						);

						const content = tags.has("ManagedTextSurfaceContribution")
							? renderTextSurface(entries)
							: tags.has("ManagedLinesSurfaceContribution")
								? renderLinesSurface(entries)
								: renderJsonSurface(path, entries);

						rendered.push({
							bucket: first.bucket,
							content,
							definitionIds,
							key:
								first.bucket.kind === "project"
									? first.contribution.surface
									: `${first.contribution.surface}`,
							kind: "surface",
							path,
						});
					}

					return rendered;
				},
				catch: (error) =>
					new RendererError({
						path: "renderer",
						message: `Render Failed: ${String(error)}`,
					}),
			}),
	}),
}) {}
