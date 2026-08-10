import { isAbsolute, join, relative, sep } from "node:path";
import {
	authenticationProviders,
	catalogs,
	type ForgeConfig,
	linters,
	optionalAddons,
	orms,
	platforms,
	rpcProviders,
	styleFrameworks,
	uiLibraries,
	webFrameworks,
} from "@ryuujs/generators";
import {
	Context,
	Effect,
	FileSystem,
	Layer,
	Option,
	Result,
	Schema,
} from "effect";
import {
	type AdoptedModuleVersions,
	allDependencyNames,
	captureVersions,
	databaseFromDependencies,
	dependencyNames,
	envNames,
	type ModuleMappingProposal,
	moduleProposal,
	oneDetected,
	packageManagerFromLockfiles,
	providerFromSignals,
	runtimeFromPackageJson,
} from "./mapping";
import {
	AdoptionFileParseError,
	AdoptionFileReadError,
	AdoptionTraversalLimitError,
	type CatalogEntry,
	ComponentsJsonSchema,
	matchesWorkspacePatterns,
	type PackageJson,
	PackageJsonSchema,
	parsePnpmWorkspace,
	workspaceFrontiers,
	workspacePatterns,
} from "./workspace";

export interface AdoptionToolingPrefills {
	readonly turbo?: true;
}

export interface AdoptionDetection {
	readonly catalogEntries: ReadonlyArray<CatalogEntry>;
	readonly config: ForgeConfig;
	readonly modules: ReadonlyArray<ModuleMappingProposal>;
	readonly tooling: AdoptionToolingPrefills;
	readonly versions: ReadonlyArray<AdoptedModuleVersions>;
}

const ignoredDirectories = new Set([
	".git",
	".next",
	".output",
	".pnpm-store",
	".react-router",
	".turbo",
	".vercel",
	".yarn",
	"coverage",
	"dist",
	"node_modules",
]);

const MAXIMUM_ADOPTION_SCAN_DEPTH = 64;
const MAXIMUM_ADOPTION_VISITED_DIRECTORIES = 10_000;
const adoptionTraversalLimitMessage =
	"We stopped scanning because your workspace patterns cover too many directories. You can narrow your workspace patterns and try again.";

interface AdoptionScanState {
	visitedDirectories: number;
}

interface AdoptionScanBounds {
	readonly depth: number;
	readonly visitedDirectories: number;
}

type AdoptionScanBoundsOverride = Partial<AdoptionScanBounds>;

const defaultAdoptionScanBounds = {
	depth: MAXIMUM_ADOPTION_SCAN_DEPTH,
	visitedDirectories: MAXIMUM_ADOPTION_VISITED_DIRECTORIES,
} satisfies AdoptionScanBounds;

const adoptionScanBounds =
	Context.Service<AdoptionScanBounds>("AdoptionScanBounds");

function normalizePath(path: string): string {
	return path.split(sep).join("/");
}

function isWithinProject(projectRoot: string, path: string): boolean {
	const pathFromRoot = relative(projectRoot, path);
	return (
		pathFromRoot === "" ||
		(pathFromRoot !== ".." &&
			!pathFromRoot.startsWith(`..${sep}`) &&
			!isAbsolute(pathFromRoot))
	);
}

function directoryDepth(projectRoot: string, path: string): number {
	const pathFromRoot = relative(projectRoot, path);
	return pathFromRoot.length === 0 ? 0 : pathFromRoot.split(sep).length;
}

const makeAdoptionDetector = Effect.gen(function* () {
	const scanBounds = yield* adoptionScanBounds;
	const fs = yield* FileSystem.FileSystem;

	const exists = Effect.fn("AdoptionDetector.exists")(function* (
		filePath: string,
	) {
		return yield* fs.exists(filePath).pipe(
			Effect.catchTag("PlatformError", (error) =>
				Effect.fail(
					new AdoptionFileReadError({
						detail: String(error),
						filePath,
						message: `Adoption File Read Failed: ${filePath}`,
					}),
				),
			),
		);
	});

	const readRequired = Effect.fn("AdoptionDetector.readRequired")(function* (
		filePath: string,
	) {
		return yield* fs.readFileString(filePath).pipe(
			Effect.catchTag("PlatformError", (error) =>
				Effect.fail(
					new AdoptionFileReadError({
						detail: String(error),
						filePath,
						message: `Adoption File Read Failed: ${filePath}`,
					}),
				),
			),
		);
	});

	const readOptional = Effect.fn("AdoptionDetector.readOptional")(function* (
		filePath: string,
	) {
		if (!(yield* exists(filePath))) return undefined;
		return yield* readRequired(filePath);
	});

	const decodePackageJson = Effect.fn("AdoptionDetector.decodePackageJson")(
		function* (filePath: string) {
			const raw = yield* readRequired(filePath);

			const decoded = Schema.decodeResult(PackageJsonSchema)(raw);
			if (Result.isFailure(decoded))
				return yield* new AdoptionFileParseError({
					detail: String(decoded.failure),
					filePath,
					message: `Adoption File Parse Failed: ${filePath}`,
				});

			return decoded.success;
		},
	);

	const readPackageJson = Effect.fn("AdoptionDetector.readPackageJson")(
		function* (filePath: string) {
			if (!(yield* exists(filePath))) return undefined;
			return yield* decodePackageJson(filePath);
		},
	);

	const isSymbolicLink = Effect.fn("AdoptionDetector.isSymbolicLink")(
		function* (filePath: string) {
			return yield* fs.readLink(filePath).pipe(
				Effect.map(() => true),
				Effect.orElseSucceed(() => false),
			);
		},
	);

	const scanPackageDirectories: (
		projectRoot: string,
		currentPath: string,
		canonicalProjectRoot: string,
		scanState: AdoptionScanState,
		scanBounds: AdoptionScanBounds,
	) => Effect.Effect<
		ReadonlyArray<string>,
		AdoptionFileReadError | AdoptionTraversalLimitError
	> = Effect.fn("AdoptionDetector.scanPackageDirectories")(function* (
		projectRoot: string,
		currentPath: string,
		canonicalProjectRoot: string,
		scanState: AdoptionScanState,
		scanBounds: AdoptionScanBounds,
	) {
		if (directoryDepth(projectRoot, currentPath) > scanBounds.depth)
			return yield* new AdoptionTraversalLimitError({
				detail: `Maximum directory depth of ${scanBounds.depth} exceeded.`,
				filePath: currentPath,
				message: adoptionTraversalLimitMessage,
			});

		scanState.visitedDirectories += 1;
		if (scanState.visitedDirectories > scanBounds.visitedDirectories)
			return yield* new AdoptionTraversalLimitError({
				detail: `Maximum visited-directory count of ${scanBounds.visitedDirectories} exceeded.`,
				filePath: currentPath,
				message: adoptionTraversalLimitMessage,
			});

		const entries = yield* fs.readDirectory(currentPath).pipe(
			Effect.catchTag("PlatformError", (error) =>
				Effect.fail(
					new AdoptionFileReadError({
						detail: String(error),
						filePath: currentPath,
						message: `Adoption Directory Read Failed: ${currentPath}`,
					}),
				),
			),
		);

		const roots: string[] = [];
		const isPackageRoot =
			entries.includes("package.json") && currentPath !== projectRoot;

		if (isPackageRoot)
			roots.push(normalizePath(relative(projectRoot, currentPath)));

		for (const entry of entries) {
			if (isPackageRoot && entry === "node_modules") continue;
			if (ignoredDirectories.has(entry)) continue;

			const fullPath = join(currentPath, entry);
			if (yield* isSymbolicLink(fullPath)) continue;

			const info = yield* fs.stat(fullPath).pipe(
				Effect.map(Option.some),
				Effect.catchTag("PlatformError", () => Effect.succeed(Option.none())),
			);

			if (Option.isNone(info) || info.value.type !== "Directory") continue;

			const canonicalPath = yield* fs.realPath(fullPath).pipe(
				Effect.map(Option.some),
				Effect.catchTag("PlatformError", () => Effect.succeed(Option.none())),
			);

			if (
				Option.isNone(canonicalPath) ||
				!isWithinProject(canonicalProjectRoot, canonicalPath.value)
			)
				continue;

			roots.push(
				...(yield* scanPackageDirectories(
					projectRoot,
					fullPath,
					canonicalProjectRoot,
					scanState,
					scanBounds,
				)),
			);
		}

		return roots;
	});

	const scanWorkspaceFrontier = Effect.fn(
		"AdoptionDetector.scanWorkspaceFrontier",
	)(function* (
		projectRoot: string,
		frontier: string,
		canonicalProjectRoot: string,
		scanState: AdoptionScanState,
		scanBounds: AdoptionScanBounds,
	) {
		let currentPath = projectRoot;

		const segments = frontier.length === 0 ? [] : frontier.split("/");
		for (const segment of segments) {
			if (ignoredDirectories.has(segment)) return [];

			const entries = yield* fs.readDirectory(currentPath).pipe(
				Effect.catchTag("PlatformError", (error) =>
					Effect.fail(
						new AdoptionFileReadError({
							detail: String(error),
							filePath: currentPath,
							message: `Adoption Directory Read Failed: ${currentPath}`,
						}),
					),
				),
			);

			if (!entries.includes(segment)) return [];

			const fullPath = join(currentPath, segment);
			if (yield* isSymbolicLink(fullPath)) return [];

			const info = yield* fs.stat(fullPath).pipe(
				Effect.map(Option.some),
				Effect.catchTag("PlatformError", () => Effect.succeed(Option.none())),
			);

			if (Option.isNone(info) || info.value.type !== "Directory") return [];

			const canonicalPath = yield* fs.realPath(fullPath).pipe(
				Effect.map(Option.some),
				Effect.catchTag("PlatformError", () => Effect.succeed(Option.none())),
			);

			if (
				Option.isNone(canonicalPath) ||
				!isWithinProject(canonicalProjectRoot, canonicalPath.value)
			)
				return [];

			currentPath = fullPath;
		}

		return yield* scanPackageDirectories(
			projectRoot,
			currentPath,
			canonicalProjectRoot,
			scanState,
			scanBounds,
		);
	});

	const readPnpmWorkspace = Effect.fn("AdoptionDetector.readPnpmWorkspace")(
		function* (projectRoot: string) {
			const filePath = join(projectRoot, "pnpm-workspace.yaml");
			const raw = yield* readOptional(filePath);
			return raw === undefined
				? undefined
				: yield* parsePnpmWorkspace(raw, filePath);
		},
	);

	const inspectWorkspace = Effect.fn("AdoptionDetector.inspectWorkspace")(
		function* (projectRoot: string) {
			const pnpmWorkspace = yield* readPnpmWorkspace(projectRoot);
			const rootPackageJson = yield* readPackageJson(
				join(projectRoot, "package.json"),
			);

			const patterns =
				pnpmWorkspace === undefined
					? rootPackageJson?.workspaces === undefined
						? []
						: workspacePatterns(rootPackageJson.workspaces)
					: pnpmWorkspace.packages;

			if (patterns.length === 0)
				return { pnpmWorkspace, rootPackageJson, roots: [] };

			const canonicalProjectRoot = yield* fs.realPath(projectRoot).pipe(
				Effect.catchTag("PlatformError", (error) =>
					Effect.fail(
						new AdoptionFileReadError({
							detail: String(error),
							filePath: projectRoot,
							message: `Adoption Directory Read Failed: ${projectRoot}`,
						}),
					),
				),
			);

			const scanState: AdoptionScanState = { visitedDirectories: 1 };
			const scannedRoots: string[] = [];
			for (const frontier of workspaceFrontiers(patterns))
				scannedRoots.push(
					...(yield* scanWorkspaceFrontier(
						projectRoot,
						frontier,
						canonicalProjectRoot,
						scanState,
						scanBounds,
					)),
				);

			const roots = scannedRoots
				.filter((root) => matchesWorkspacePatterns(root, patterns))
				.sort((left, right) => left.localeCompare(right));

			return { pnpmWorkspace, rootPackageJson, roots };
		},
	);

	const enumerate = Effect.fn("AdoptionDetector.enumerate")(function* (
		projectRoot: string,
	) {
		return (yield* inspectWorkspace(projectRoot)).roots;
	});

	const rootPackageName = Effect.fn("AdoptionDetector.rootPackageName")(
		function* (projectRoot: string) {
			return (yield* readPackageJson(join(projectRoot, "package.json")))?.name;
		},
	);

	const readComponentsStyle = Effect.fn("AdoptionDetector.readComponentsStyle")(
		function* (filePath: string) {
			const raw = yield* readOptional(filePath);
			if (raw === undefined) return undefined;

			const decoded = Schema.decodeResult(ComponentsJsonSchema)(raw);
			if (Result.isFailure(decoded))
				return yield* new AdoptionFileParseError({
					detail: String(decoded.failure),
					filePath,
					message: `Adoption File Parse Failed: ${filePath}`,
				});

			return decoded.success.style ?? "";
		},
	);

	const detect = Effect.fn("AdoptionDetector.detect")(function* (
		projectRoot: string,
	) {
		const { pnpmWorkspace, rootPackageJson, roots } =
			yield* inspectWorkspace(projectRoot);

		const packageJsonByRoot = new Map<string, PackageJson>();
		const componentsByRoot = new Map<string, string>();

		for (const root of roots) {
			const packageJson = yield* decodePackageJson(
				join(projectRoot, root, "package.json"),
			);

			packageJsonByRoot.set(root, packageJson);

			const componentsStyle = yield* readComponentsStyle(
				join(projectRoot, root, "components.json"),
			);

			if (componentsStyle !== undefined)
				componentsByRoot.set(root, componentsStyle);
		}

		const rootEntries = yield* fs.readDirectory(projectRoot).pipe(
			Effect.catchTag("PlatformError", (error) =>
				Effect.fail(
					new AdoptionFileReadError({
						detail: String(error),
						filePath: projectRoot,
						message: `Adoption Directory Read Failed: ${projectRoot}`,
					}),
				),
			),
		);

		const rootEntrySet = new Set(rootEntries);
		const allPackages = [
			...(rootPackageJson === undefined ? [] : [rootPackageJson]),
			...packageJsonByRoot.values(),
		];

		const directDependencies = new Set(
			allPackages.flatMap((packageJson) => [...dependencyNames(packageJson)]),
		);

		const allDependencies = new Set(
			allPackages.flatMap((packageJson) => [
				...allDependencyNames(packageJson),
			]),
		);

		const envFiles: string[] = [];
		for (const name of [
			".env",
			".env.development",
			".env.example",
			".env.local",
		]) {
			const raw = yield* readOptional(join(projectRoot, name));
			if (raw !== undefined) envFiles.push(raw);
		}

		const detectedEnvNames = envNames(envFiles);

		const web = oneDetected([
			directDependencies.has("next")
				? webFrameworks.normalize("nextjs")
				: undefined,
			directDependencies.has("react-router")
				? webFrameworks.normalize("react-router")
				: undefined,
			directDependencies.has("@tanstack/react-start")
				? webFrameworks.normalize("tanstack-start")
				: undefined,
		]);

		const orm = oneDetected([
			directDependencies.has("drizzle-orm")
				? orms.normalize("drizzle")
				: undefined,
			directDependencies.has("@prisma/client")
				? orms.normalize("prisma")
				: undefined,
		]);

		const authentication = directDependencies.has("better-auth")
			? authenticationProviders.normalize("better-auth")
			: undefined;

		const rpc = directDependencies.has("@trpc/server")
			? rpcProviders.normalize("trpc")
			: undefined;

		const style = allDependencies.has("tailwindcss")
			? styleFrameworks.normalize("tailwind")
			: undefined;

		const componentsStyles = [...componentsByRoot.values()];
		const uiLibrary = oneDetected([
			directDependencies.has("@base-ui/react") ||
			componentsStyles.some((value) => value.startsWith("base"))
				? uiLibraries.normalize("base-ui")
				: undefined,
			componentsStyles.some((value) => value.startsWith("radix"))
				? uiLibraries.normalize("radix")
				: undefined,
		]);

		const hasBiome = ["biome.json", "biome.jsonc"].some((name) =>
			rootEntrySet.has(name),
		);

		const hasEslint = [
			".eslintrc",
			".eslintrc.cjs",
			".eslintrc.js",
			".eslintrc.json",
			".eslintrc.yaml",
			".eslintrc.yml",
			"eslint.config.cjs",
			"eslint.config.js",
			"eslint.config.mjs",
			"eslint.config.mts",
			"eslint.config.ts",
		].some((name) => rootEntrySet.has(name));

		const linter = oneDetected([
			hasBiome ? linters.normalize("biome") : undefined,
			hasEslint && linters.available("eslint-prettier")
				? linters.normalize("eslint-prettier")
				: undefined,
		]);

		const addons = [
			rootEntrySet.has("commitlint.config.ts")
				? optionalAddons.normalize("commitlint")
				: undefined,
			rootEntrySet.has("lefthook.yml")
				? optionalAddons.normalize("lefthook")
				: undefined,
			[...rootEntrySet].some((name) => /^vitest\.config\./.test(name))
				? optionalAddons.normalize("vitest")
				: undefined,
		].filter((addon) => addon !== undefined);

		const packageManager = packageManagerFromLockfiles(rootEntrySet);

		const nvmrc = yield* readOptional(join(projectRoot, ".nvmrc"));
		const runtime = runtimeFromPackageJson(
			rootPackageJson,
			nvmrc !== undefined && nvmrc.trim().length > 0,
		);

		const database = databaseFromDependencies(allDependencies);
		const databaseProvider = providerFromSignals(
			database,
			allDependencies,
			detectedEnvNames,
		);

		const hasFlatCatalog = pnpmWorkspace?.catalogEntries.some(
			(entry) => entry.catalog === undefined,
		);

		const hasScopedCatalog = pnpmWorkspace?.catalogEntries.some(
			(entry) => entry.catalog !== undefined,
		);

		const catalogMode = oneDetected([
			hasFlatCatalog ? catalogs.normalize("flat") : undefined,
			hasScopedCatalog ? catalogs.normalize("scoped") : undefined,
		]);

		const webPlatform = platforms.normalize("web");

		const config: ForgeConfig = {
			...(addons.length === 0 ? {} : { addons }),
			...(authentication === undefined ? {} : { authentication }),
			...(catalogMode === undefined ? {} : { catalogs: catalogMode }),
			...(database === undefined ? {} : { database }),
			...(databaseProvider === undefined ? {} : { databaseProvider }),
			...(linter === undefined ? {} : { linter }),
			...(orm === undefined ? {} : { orm }),
			...(packageManager === undefined ? {} : { packageManager }),
			...(rpc === undefined ? {} : { rpc }),
			...(runtime === undefined ? {} : { runtime }),
			...(style === undefined ? {} : { style }),
			...(uiLibrary === undefined ? {} : { uiLibrary }),
			...(web === undefined || webPlatform === undefined
				? {}
				: { platforms: [webPlatform], web }),
		};

		const modules = roots.map((root) =>
			moduleProposal(
				root,
				packageJsonByRoot.get(root) ?? {},
				componentsByRoot.has(root),
			),
		);

		const versions = modules.flatMap((module) => {
			if (module.proposal === "unadopted") return [];

			const packageJson = packageJsonByRoot.get(module.root);
			return packageJson === undefined
				? []
				: [
						captureVersions(
							module.root,
							packageJson,
							pnpmWorkspace?.catalogEntries ?? [],
						),
					];
		});

		return {
			catalogEntries: pnpmWorkspace?.catalogEntries ?? [],
			config,
			modules,
			tooling: rootEntrySet.has("turbo.json") ? { turbo: true } : {},
			versions,
		} satisfies AdoptionDetection;
	});

	return { detect, enumerate, rootPackageName };
});

type AdoptionDetectorService = Effect.Success<typeof makeAdoptionDetector>;

export class AdoptionDetector extends Context.Service<
	AdoptionDetector,
	AdoptionDetectorService
>()("AdoptionDetector") {
	static readonly Default = Layer.effect(
		AdoptionDetector,
		makeAdoptionDetector,
	).pipe(
		Layer.provide(Layer.succeed(adoptionScanBounds, defaultAdoptionScanBounds)),
	);
	static readonly detect = (
		...args: Parameters<AdoptionDetectorService["detect"]>
	) => AdoptionDetector.use((service) => service.detect(...args));
	static readonly enumerate = (
		...args: Parameters<AdoptionDetectorService["enumerate"]>
	) => AdoptionDetector.use((service) => service.enumerate(...args));
	static readonly rootPackageName = (
		...args: Parameters<AdoptionDetectorService["rootPackageName"]>
	) => AdoptionDetector.use((service) => service.rootPackageName(...args));
}

export const AdoptionDetectorTest = {
	layer: (scanBoundsOverride: AdoptionScanBoundsOverride = {}) =>
		Layer.effect(AdoptionDetector, makeAdoptionDetector).pipe(
			Layer.provide(
				Layer.succeed(adoptionScanBounds, {
					...defaultAdoptionScanBounds,
					...scanBoundsOverride,
				} satisfies AdoptionScanBounds),
			),
		),
};
