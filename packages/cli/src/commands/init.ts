import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	confirm,
	intro,
	isCancel,
	log,
	multiselect,
	note,
	outro,
	select,
} from "@clack/prompts";
import {
	Apply,
	ApplyError,
	ConfigSchema,
	ConfigStore,
	formatApplyError,
	formatSchemaError,
	hashContentHex,
	type InstalledPlanningSeed,
	type InstallRecord,
	type InstallTarget,
	isUserOwnedEnv,
	type LockfileArtifact,
	type Manifest,
	Planner,
	packageManagerCommand,
	State,
	type StateBundle,
	SURFACE_MERGE_SEMANTICS_VERSION,
} from "@ryuugg/core";
import {
	type ForgeConfig,
	loadDefinitionRegistry,
	mobileAppFrameworkIds,
	probeWorkspaceCommandVersions,
	standaloneBackendIds,
	webFrameworks,
} from "@ryuugg/generators";
import { Effect, Exit, FileSystem, Option, Result, Schema } from "effect";
import { orchestrate } from "../orchestrator";
import { failureFromCause, runCliEffect, runCliEffectValue } from "../runtime";
import { steps } from "../steps";
import { createAuthMethodsStep } from "../steps/auth/methods";
import { firstPartyAddonIds, webAppsSchema } from "../steps/platforms/web-apps";
import { createPackageManagerStep } from "../steps/project/package-manager";
import { createPathStep } from "../steps/project/path";
import { SKIP } from "../steps/types";
import { cancel } from "../utils/cancel";
import { listAnd } from "../utils/list";
import { refusalMessage } from "../utils/refusal";
import { slugify } from "../utils/slugify";
import {
	type AdoptedModuleVersions,
	type AdoptionDetection,
	AdoptionDetector,
	type AdoptionLayout,
	adoptedWebConfig,
	adoptionRefusal,
	type CommandPins,
	type ConfirmedModule,
	type ModuleKind,
	type ModuleMappingProposal,
	primaryWebAppRefusal,
	primaryWebRoot,
	resolveWebAppAdoption,
	rpcProviderRefusal,
	secondaryWebAppsSentence,
	type WebAppObservation,
	webRoots,
} from "./adoption";
import { applyInstalledPlan } from "./lifecycle";
import { resolutionArguments } from "./resolution";

const moduleKinds: ReadonlyArray<ModuleKind> = [
	"web-app",
	"backend-app",
	"db",
	"auth",
	"trpc",
	"orpc",
	"ui",
];

export function initSteps(commandPins: CommandPins) {
	return steps
		.filter(
			(step) =>
				!new Set([
					"intro",
					"emailProvider",
					"summary",
					"generate",
					"installDeps",
					"gitInit",
					"outro",
				]).has(step.id),
		)
		.map((step) =>
			step.id === "authMethods"
				? createAuthMethodsStep({ email: false })
				: step.id === "packageManager"
					? createPackageManagerStep(commandPins.packageManager)
					: step.id === "path"
						? createPathStep("existing")
						: step.id === "webApps" || step.id === "webName"
							? { ...step, execute: async () => SKIP }
							: step,
		);
}

interface InitConfigFile {
	readonly config: Omit<typeof InitConfigFileSchema.Type, "modules">;
	readonly modules: ReadonlyArray<ConfirmedModule>;
}

class InitPlanningError extends Schema.TaggedError<InitPlanningError>()(
	"InitPlanningError",
	{ message: Schema.String },
) {}

export interface AdoptionPlan {
	readonly applyPlan: Parameters<typeof Apply.applyPlan>[1];
	readonly artifactCounts: Readonly<Record<string, number>>;
	readonly commandVersions: Readonly<Record<string, string>>;
	readonly manifest: Manifest;
	readonly markerPaths: ReadonlyArray<string>;
}

const ConfirmedModulesSchema = Schema.Array(
	Schema.Struct({
		kind: Schema.Literals(moduleKinds),
		root: Schema.String,
	}),
);

const InitConfigFileSchema = Schema.StructWithRest(
	Schema.Struct({
		modules: ConfirmedModulesSchema,
		webApps: Schema.optional(webAppsSchema),
	}),
	[Schema.Record(Schema.String, Schema.Unknown)],
);

function reportFailure(message: string): never {
	log.error(message);
	process.exit(1);
}

function schemaMessage(error: Schema.SchemaError, input: unknown): string {
	return formatSchemaError(error, input)
		.map((issue) =>
			issue.path.length > 0
				? `  ${issue.path.join(".")}: ${issue.message}`
				: `  ${issue.message}`,
		)
		.join("\n");
}

export function readInitConfigFile(filePath: string): InitConfigFile {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(filePath, "utf-8"));
	} catch {
		return reportFailure(
			`We couldn't read or parse the config file at "${filePath}".`,
		);
	}

	const result = Schema.decodeUnknownResult(InitConfigFileSchema)(parsed);
	if (Result.isFailure(result))
		reportFailure(
			`Your config file is invalid.\n${schemaMessage(result.failure, parsed)}`,
		);

	const { modules: _modules, ...config } = result.success;
	return { config, modules: result.success.modules };
}

function displayValue(value: unknown): string {
	return Array.isArray(value)
		? listAnd.format(value.map(String))
		: String(value);
}

export async function confirmDetection(
	detection: AdoptionDetection,
): Promise<Record<string, unknown>> {
	const config: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(detection.config)) {
		const accepted = await confirm({
			initialValue: true,
			message: `We detected ${key} as ${displayValue(value)}. Use it?`,
		});

		if (isCancel(accepted)) cancel();
		if (accepted) config[key] = value;
	}

	return config;
}

function validateConfirmedModules(
	modules: ReadonlyArray<ConfirmedModule>,
	proposals: ReadonlyArray<ModuleMappingProposal>,
): ReadonlyArray<ConfirmedModule> {
	const proposalByRoot = new Map(
		proposals.map((proposal) => [proposal.root, proposal]),
	);

	const seenRoots = new Set<string>();
	for (const module of modules) {
		const proposal = proposalByRoot.get(module.root);
		if (proposal === undefined)
			return reportFailure(
				`Your config maps "${module.root}", but it isn't a workspace module.`,
			);

		if (seenRoots.has(module.root))
			return reportFailure(`Your config maps "${module.root}" more than once.`);

		seenRoots.add(module.root);
	}

	return modules;
}

export async function choosePrimaryWebRoot(
	modules: ReadonlyArray<ConfirmedModule>,
	observations: ReadonlyArray<WebAppObservation>,
	interactive: boolean,
): Promise<string | undefined> {
	const roots = webRoots(modules);
	const primary = primaryWebRoot(roots);
	if (primary !== undefined || roots.length === 0) return primary;
	if (!interactive) return reportFailure(primaryWebAppRefusal);

	const selected = await select({
		message: "Which web app is the primary app?",
		options: roots.map((root) => {
			const [framework, ...others] =
				observations.find((observation) => observation.root === root)
					?.frameworks ?? [];

			return {
				label:
					framework === undefined || others.length > 0
						? root
						: `${root} (${webFrameworks.label(framework)})`,
				value: root,
			};
		}),
	});

	if (isCancel(selected)) cancel();
	return selected;
}

export async function confirmMappings(
	proposals: ReadonlyArray<ModuleMappingProposal>,
): Promise<ReadonlyArray<ConfirmedModule>> {
	const candidates = proposals.filter(
		(proposal): proposal is ModuleMappingProposal & { proposal: ModuleKind } =>
			proposal.proposal !== "unadopted",
	);

	if (candidates.length === 0) return [];

	const selected = await multiselect({
		initialValues: candidates.map((proposal) => proposal.root),
		message: "Which proposed module mappings do you want Forge to adopt?",
		options: candidates.map((proposal) => ({
			hint: `We ${proposal.evidence}.`,
			label: `${proposal.root} as ${proposal.proposal}`,
			value: proposal.root,
		})),
		required: false,
	});

	if (isCancel(selected)) cancel();

	return validateConfirmedModules(
		candidates.flatMap((proposal) =>
			selected.includes(proposal.root)
				? [{ kind: proposal.proposal, root: proposal.root }]
				: [],
		),
		proposals,
	);
}

function attachVersions(
	installs: ReadonlyArray<InstallRecord>,
	versions: ReadonlyArray<AdoptedModuleVersions>,
	dependencyNames: Readonly<Record<string, ReadonlyArray<string>>>,
): ReadonlyArray<InstallRecord> {
	return installs.map((install) => {
		const names = new Set(dependencyNames[install.definitionId]);
		const captured = versions.flatMap((module) =>
			module.dependencies.flatMap((dependency) =>
				names.has(dependency.name)
					? [{ ...dependency, root: module.root }]
					: [],
			),
		);

		return captured.length === 0 ? install : { ...install, versions: captured };
	});
}

export function contentHashError(path: string) {
	return new InitPlanningError({ message: `Content Hash Failed: ${path}` });
}

function modulePrototype(
	kind: ModuleKind,
	modules: InstalledPlanningSeed["modules"],
	root: string,
	prototypeRoots: ReadonlyMap<string, string>,
) {
	if (kind === "web-app") {
		const prototypeRoot = prototypeRoots.get(root) ?? root;
		return modules.find(
			(module) =>
				module.type === "app" &&
				!standaloneBackendIds.has(module.framework) &&
				!mobileAppFrameworkIds.has(module.framework) &&
				module.root === prototypeRoot,
		);
	}

	if (kind === "backend-app")
		return modules.find(
			(module) =>
				module.type === "app" && standaloneBackendIds.has(module.framework),
		);

	return modules.find(
		(module) => module.type === "package" && module.template.id === kind,
	);
}

export function buildAdoptionPlan(
	projectRoot: string,
	layout: AdoptionLayout,
	confirmedModules: ReadonlyArray<ConfirmedModule>,
	versions: ReadonlyArray<AdoptedModuleVersions>,
	proposals: ReadonlyArray<ModuleMappingProposal> = [],
) {
	return Effect.gen(function* () {
		const { commandPins, config, prototypeRoots } = layout;
		const loadedRegistry = yield* Effect.sync(() => loadDefinitionRegistry());
		const packageManager = config.packageManager ?? "pnpm";
		const pinnedPackageManager =
			commandPins.packageManager?.packageManager === packageManager
				? {
						[packageManagerCommand(packageManager)]:
							commandPins.packageManager.version,
					}
				: {};

		const commandVersions = yield* probeWorkspaceCommandVersions(config, {
			...pinnedPackageManager,
			...(commandPins.node === undefined ? {} : { node: commandPins.node }),
		});

		const planner = yield* Planner;
		const configStore = yield* ConfigStore;
		const fs = yield* FileSystem.FileSystem;

		const emptySeed: InstalledPlanningSeed = { modules: [], records: {} };
		const createPlan = yield* planner.planCreate(
			projectRoot,
			config,
			loadedRegistry.registry,
			commandVersions,
			emptySeed,
		);

		const prototypes = yield* Effect.forEach(
			createPlan.writes.filter((write) => write.path.endsWith("/forge.json")),
			(write) =>
				Schema.decodeEffect(Schema.fromJsonString(ConfigSchema))(
					write.content,
				).pipe(
					Effect.map((module) => ({
						...module,
						root: dirname(write.path),
					})),
				),
		);

		const confirmedKinds = new Set(
			confirmedModules.map((module) => module.kind),
		);

		const confirmedRoots = new Set(
			confirmedModules.map((module) => module.root),
		);

		for (const proposal of proposals) {
			if (
				proposal.proposal === "unadopted" ||
				confirmedRoots.has(proposal.root) ||
				confirmedKinds.has(proposal.proposal)
			)
				continue;

			const prototype = modulePrototype(
				proposal.proposal,
				prototypes,
				proposal.root,
				prototypeRoots,
			);

			if (prototype?.root !== proposal.root) continue;

			return yield* new InitPlanningError({
				message: `We can't leave "${proposal.root}" unmanaged because the confirmed configuration requires a ${proposal.proposal} module there. Include it in the adoption and try again.`,
			});
		}

		const usedIds = new Set<string>();
		const adoptedModules: InstalledPlanningSeed["modules"][number][] = [];
		const records: Record<
			string,
			{ readonly definitionIds: ReadonlyArray<string>; readonly root: string }
		> = {};

		const prototypeIdByAdoptedId = new Map<string, string>();
		for (const mapping of confirmedModules) {
			const prototype = modulePrototype(
				mapping.kind,
				prototypes,
				mapping.root,
				prototypeRoots,
			);

			if (prototype === undefined)
				return yield* new InitPlanningError({
					message: `Adoption Mapping Invalid: ${mapping.root} cannot be mapped as ${mapping.kind} with this configuration.`,
				});

			const id = yield* configStore.generateId(usedIds);
			usedIds.add(id);

			const adopted = { ...prototype, id, root: mapping.root };
			adoptedModules.push(adopted);

			prototypeIdByAdoptedId.set(id, prototype.id);

			const prototypeRecord = createPlan.manifest.modules[prototype.id];
			records[id] = {
				definitionIds: [...(prototypeRecord?.definitionIds ?? [])],
				root: mapping.root,
			};
		}

		const adoptedByPrototypeId = new Map<string, string[]>();
		for (const [adoptedId, prototypeId] of prototypeIdByAdoptedId)
			adoptedByPrototypeId.set(prototypeId, [
				...(adoptedByPrototypeId.get(prototypeId) ?? []),
				adoptedId,
			]);

		const installs = attachVersions(
			createPlan.manifest.installs
				.map((install): InstallRecord => {
					const targets: InstallTarget[] = [];
					for (const target of install.targets) {
						if (target.kind === "project") {
							targets.push(target);
							continue;
						}

						for (const moduleId of adoptedByPrototypeId.get(target.moduleId) ??
							[])
							targets.push({ kind: "module", moduleId });
					}

					return { ...install, targets };
				})
				.filter((install) => install.targets.length > 0),
			versions.filter((module) => confirmedRoots.has(module.root)),
			createPlan.dependencyNames,
		);

		const seed = {
			modules: adoptedModules,
			records,
		} satisfies InstalledPlanningSeed;

		const planned = yield* planner.planInstalled(
			projectRoot,
			config,
			installs,
			loadedRegistry.registry,
			commandVersions,
			loadedRegistry.descriptors,
			undefined,
			seed,
		);

		const artifacts: Record<string, LockfileArtifact> = {};
		const baseContents: Record<string, string> = {};
		const markerWrites: Parameters<
			typeof Apply.applyPlan
		>[1]["writes"][number][] = [];

		const artifactCounts: Record<string, number> = {
			".": 0,
			...Object.fromEntries(confirmedModules.map((module) => [module.root, 0])),
		};

		const adoptedIds = new Set(adoptedModules.map((module) => module.id));
		for (const write of planned.writes) {
			if (
				write.target.kind === "module" &&
				!adoptedIds.has(write.target.moduleId)
			)
				continue;

			const artifact = planned.lockfile.artifacts[write.artifactId];
			if (artifact === undefined) continue;

			if (write.path.endsWith("/forge.json")) {
				artifacts[write.artifactId] = artifact;
				markerWrites.push({
					artifactId: write.artifactId,
					content: write.content,
					path: write.path,
				});

				continue;
			}

			if (isUserOwnedEnv(write.path)) continue;

			const fullPath = join(projectRoot, write.path);
			if (!(yield* fs.exists(fullPath))) continue;

			const content = yield* fs.readFileString(fullPath);
			const hash = yield* hashContentHex(content, () =>
				contentHashError(write.path),
			);

			artifacts[write.artifactId] = {
				...artifact,
				base: {
					hash,
					mergeKind: artifact.base?.mergeKind ?? "opaque",
					origin: "adopted",
					semanticsVersion: SURFACE_MERGE_SEMANTICS_VERSION,
				},
				hash,
			};

			baseContents[write.artifactId] = content;

			const module = confirmedModules.find(
				(candidate) =>
					write.path === candidate.root ||
					write.path.startsWith(`${candidate.root}/`),
			);

			if (module !== undefined)
				artifactCounts[module.root] = (artifactCounts[module.root] ?? 0) + 1;
			else artifactCounts["."] = (artifactCounts["."] ?? 0) + 1;
		}

		const manifest = {
			...planned.manifest,
			modules: Object.fromEntries(
				Object.entries(planned.manifest.modules).filter(([id]) =>
					adoptedIds.has(id),
				),
			),
		} satisfies Manifest;

		return {
			applyPlan: {
				baseContents,
				lockfile: { artifacts },
				manifest,
				removals: [],
				writes: markerWrites,
			},
			artifactCounts,
			commandVersions,
			manifest,
			markerPaths: markerWrites.map((write) => write.path),
		};
	});
}

function existingArtifacts(count: number): string {
	return `${String(count)} existing artifact${count === 1 ? "" : "s"}`;
}

function formatRows(rows: ReadonlyArray<readonly [string, string]>): string {
	const width = Math.max(...rows.map(([label]) => label.length));
	return rows
		.map(([label, value]) => `${`${label}:`.padEnd(width + 1)}  ${value}`)
		.join("\n");
}

export function adoptionReport(
	modules: ReadonlyArray<ConfirmedModule>,
	plan: AdoptionPlan,
): string {
	const rows: Array<readonly [string, string]> = [
		["Project", existingArtifacts(plan.artifactCounts["."] ?? 0)],
		...modules.map((module): readonly [string, string] => [
			module.root,
			`${module.kind}, ${existingArtifacts(plan.artifactCounts[module.root] ?? 0)}`,
		]),
		...plan.markerPaths.map((path): readonly [string, string] => [
			"Write marker",
			path,
		]),
	];

	const config = plan.manifest.config;
	const sentence = secondaryWebAppsSentence(
		Schema.is(webAppsSchema)(config.webApps) ? config.webApps : undefined,
	);

	return [
		formatRows(rows),
		...(sentence === undefined ? [] : [sentence]),
		`Forge will record this config:\n${JSON.stringify(config, null, 2)}`,
	].join("\n\n");
}

export function defaultIdentity(projectRoot: string, packageName?: string) {
	const source = packageName ?? basename(projectRoot);
	const raw = slugify(source).slice(0, 15).replace(/-$/, "");
	const slug = raw.length === 0 ? "project" : raw;
	return { name: packageName ?? slug, slug };
}

function isEmptyPreviousState(bundle: StateBundle): boolean {
	return (
		Object.keys(bundle.lockfile.artifacts).length === 0 &&
		Object.keys(bundle.manifest.config).length === 0 &&
		bundle.manifest.installs.length === 0 &&
		Object.keys(bundle.manifest.modules).length === 0
	);
}

export function initDirectoryRefusal(projectRoot: string) {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = join(projectRoot, ".forge");
		if (!(yield* fs.exists(directory))) return undefined;

		const stateBundleResult = yield* State.readStateBundle(projectRoot).pipe(
			Effect.result,
		);

		if (
			Result.isFailure(stateBundleResult) &&
			stateBundleResult.failure.reason === "schema-version-unknown"
		)
			return stateBundleResult.failure.message;

		const stateResults = yield* Effect.all([
			State.readManifest(projectRoot).pipe(Effect.asVoid, Effect.result),
			State.readLockfile(projectRoot).pipe(Effect.asVoid, Effect.result),
		]);

		for (const result of stateResults)
			if (
				Result.isFailure(result) &&
				result.failure.reason === "schema-version-unknown"
			)
				return result.failure.message;

		const stateBundle = Result.getSuccess(stateBundleResult);

		const manifestExists = yield* fs.exists(join(directory, "manifest.json"));
		const lockfileExists = yield* fs.exists(join(directory, "lock.json"));
		if (
			Option.isSome(stateBundle) &&
			stateBundle.value !== undefined &&
			isEmptyPreviousState(stateBundle.value) &&
			(!manifestExists || !lockfileExists)
		)
			return 'A previous Forge adoption stopped before it finished. You need to delete the ".forge" directory, then run forge init again.';

		return 'A ".forge" directory already exists here. You need to remove it before running forge init.';
	});
}

function executeAdoptionPlanning(
	projectRoot: string,
	layout: AdoptionLayout,
	modules: ReadonlyArray<ConfirmedModule>,
	versions: ReadonlyArray<AdoptedModuleVersions>,
	proposals: ReadonlyArray<ModuleMappingProposal>,
) {
	return runCliEffectValue(
		buildAdoptionPlan(projectRoot, layout, modules, versions, proposals).pipe(
			Effect.catch((failure) =>
				Effect.sync(() =>
					reportFailure(
						refusalMessage(failure) ??
							`We couldn't plan this adoption. ${failure instanceof Error ? failure.message : String(failure)}`,
					),
				),
			),
		),
	);
}

function formatInitApplyError(error: ApplyError): string {
	const report = formatApplyError(error, {
		includeResolutionGuidance: false,
	});

	if (error.preflight?.hasUnmanagedRefusals !== true) return report;

	const unmanagedRefusalCount =
		error.preflight.refusals?.filter(
			(refusal) => refusal.reason === "unmanaged-file-exists",
		).length ?? 0;

	const subject = unmanagedRefusalCount === 1 ? "it" : "those files";
	return `${report}\nMove or delete ${subject}, then run forge init again.`;
}

async function executePlannedAdoption(
	values: Record<string, string | boolean | string[] | undefined>,
	projectRoot: string,
	modules: ReadonlyArray<ConfirmedModule>,
	plan: AdoptionPlan,
) {
	note(adoptionReport(modules, plan), "Forge Adoption Plan");

	if (values["dry-run"] === true) {
		outro("Dry run complete. We didn't write any files.");
		return;
	}

	const applyExit = await runCliEffect(
		Apply.applyPlan(projectRoot, plan.applyPlan),
	);

	if (Exit.isFailure(applyExit)) {
		const failure = failureFromCause(applyExit.cause);
		return reportFailure(
			`We couldn't adopt this project. ${failure instanceof ApplyError ? formatInitApplyError(failure) : failure instanceof Error ? failure.message : String(failure)}`,
		);
	}

	if (values.reconcile === true)
		await applyInstalledPlan(
			projectRoot,
			plan.manifest.config,
			plan.manifest.installs,
			plan.commandVersions,
			plan.manifest.registries,
			...resolutionArguments(values),
		);

	const reconciled = values.reconcile === true;
	if (!reconciled) log.message(adoptionConflictGuidance());
	outro(adoptionOutro(reconciled));
}

export function adoptionConflictGuidance(): string {
	return "If conflicts surface, we can guide you through them interactively, or you can run forge update with --keep-user or --accept-forge.";
}

export function adoptionOutro(reconciled: boolean): string {
	if (reconciled) return "This project is managed by Forge and reconciled.";
	return "This project is now managed by Forge. Run forge update to reconcile it.";
}

export async function runInit(
	values: Record<string, string | boolean | string[] | undefined>,
	projectRoot = resolve("."),
) {
	const directoryRefusal = await runCliEffectValue(
		initDirectoryRefusal(projectRoot),
	);

	if (directoryRefusal !== undefined) return reportFailure(directoryRefusal);

	intro("We're adopting this project into Forge...");
	const detectionExit = await runCliEffect(
		AdoptionDetector.detect(projectRoot),
	);

	if (Exit.isFailure(detectionExit)) {
		const failure = failureFromCause(detectionExit.cause);
		return reportFailure(
			failure instanceof Error ? failure.message : String(failure),
		);
	}

	const detection = detectionExit.value;
	const rootPackageNameExit = await runCliEffect(
		AdoptionDetector.rootPackageName(projectRoot),
	);

	if (Exit.isFailure(rootPackageNameExit)) {
		const failure = failureFromCause(rootPackageNameExit.cause);
		return reportFailure(
			failure instanceof Error ? failure.message : String(failure),
		);
	}

	const rootPackageName = rootPackageNameExit.value;
	const configFile =
		typeof values.config === "string"
			? readInitConfigFile(values.config)
			: undefined;

	const yes = values.yes === true;
	const interactive = configFile === undefined && !yes;
	const modules =
		configFile !== undefined
			? validateConfirmedModules(configFile.modules, detection.modules)
			: yes
				? validateConfirmedModules(
						detection.modules.flatMap((proposal) =>
							proposal.proposal === "unadopted"
								? []
								: [{ kind: proposal.proposal, root: proposal.root }],
						),
						detection.modules,
					)
				: await confirmMappings(detection.modules);

	const rpcRefusal = rpcProviderRefusal(modules);
	if (rpcRefusal !== undefined) return reportFailure(rpcRefusal.message);

	const primaryRoot = await choosePrimaryWebRoot(
		modules,
		detection.webApps,
		interactive,
	);

	const resolvedExit = await runCliEffect(
		resolveWebAppAdoption({
			addonIds: firstPartyAddonIds(),
			confirmed: modules,
			observations: detection.webApps,
			primaryRoot,
			requested: configFile?.config ?? {},
		}),
	);

	if (Exit.isFailure(resolvedExit))
		return reportFailure(failureFromCause(resolvedExit.cause).message);

	const resolved = resolvedExit.value;
	const configSlug = configFile?.config.slug;
	const earlySlug =
		typeof configSlug === "string"
			? configSlug
			: yes
				? defaultIdentity(projectRoot, rootPackageName).slug
				: undefined;

	const configBackend = configFile?.config.backend ?? detection.config.backend;
	const earlyRefusal =
		interactive || earlySlug === undefined
			? undefined
			: adoptionRefusal(resolved, {
					slug: earlySlug,
					slugGuessed: typeof configSlug !== "string",
					backend: configBackend,
				});

	if (earlyRefusal !== undefined) return reportFailure(earlyRefusal.message);

	const sentence = secondaryWebAppsSentence(resolved.webApps);
	if (sentence !== undefined) log.message(sentence);

	const detectedConfig = interactive
		? await confirmDetection(detection)
		: detection.config;

	const requestedConfig: Record<string, unknown> = {
		...(yes ? defaultIdentity(projectRoot, rootPackageName) : {}),
		...detectedConfig,
		...(configFile?.config ?? {}),
	};

	const { webName, ...withoutWebName } = requestedConfig;
	const initialConfig = {
		...withoutWebName,
		...adoptedWebConfig(resolved, requestedConfig),
		path: ".",
	};

	const config = await orchestrate(initSteps(detection.commandPins), {
		initialConfig,
		interactive,
	});

	const lateRefusal = adoptionRefusal(resolved, {
		slug: typeof config.slug === "string" ? config.slug : "my-app",
		backend: config.backend,
	});

	if (lateRefusal !== undefined) return reportFailure(lateRefusal.message);

	const plan = await executeAdoptionPlanning(
		projectRoot,
		{
			commandPins: detection.commandPins,
			config: config satisfies ForgeConfig,
			prototypeRoots: resolved.prototypeRoots,
		},
		modules,
		detection.versions,
		detection.modules,
	);

	await executePlannedAdoption(values, projectRoot, modules, plan);
}
