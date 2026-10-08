import { basename } from "node:path";
import { formatSchemaError } from "@ryuugg/core";
import {
	backends,
	type ForgeConfig,
	primaryWebAppName,
	type WebAppConfig,
	type WebFramework,
	webAppNamesIssue,
	webAppPortIssue,
	webDevPort,
	webFrameworks,
} from "@ryuugg/generators";
import { Effect, Result, Schema } from "effect";
import {
	webAppNameIssue,
	webAppNameRuleIssue,
	webAppsSchema,
} from "../../steps/platforms/web-apps";
import { listAnd } from "../../utils/list";
import type { CommandPins, ConfirmedModule } from "./mapping";

type PortScript = "dev" | "start";

export type ScriptPort =
	| { readonly kind: "absent" }
	| { readonly kind: "literal"; readonly port: number }
	| {
			readonly kind: "ambiguous";
			readonly dev: ReadonlyArray<number>;
			readonly start: ReadonlyArray<number>;
	  }
	| { readonly kind: "conflict"; readonly dev: number; readonly start: number };

export interface WebAppObservation {
	readonly root: string;
	readonly packageName?: string;
	readonly frameworks: ReadonlyArray<WebFramework>;
	readonly scriptPort: ScriptPort;
	readonly rpcPackages: ReadonlyArray<string>;
}

export interface AdoptedWebApp extends WebAppConfig {
	readonly port: number;
}

export interface AdoptedSecondary {
	readonly root: string;
	readonly packageName?: string;
	readonly app: AdoptedWebApp;
}

export interface ResolvedWebApps {
	readonly web?: WebFramework;
	readonly webName?: string;
	readonly webApps: ReadonlyArray<AdoptedWebApp>;
	readonly secondaries: ReadonlyArray<AdoptedSecondary>;
	readonly prototypeRoots: ReadonlyMap<string, string>;
}

export interface AdoptionLayout {
	readonly config: ForgeConfig;
	readonly commandPins: CommandPins;
	readonly prototypeRoots: ReadonlyMap<string, string>;
}

export interface RequestedWebApps {
	readonly webApps?: ReadonlyArray<WebAppConfig>;
}

export interface WebAppAdoptionInput {
	readonly confirmed: ReadonlyArray<ConfirmedModule>;
	readonly observations: ReadonlyArray<WebAppObservation>;
	readonly primaryRoot: string | undefined;
	readonly requested: RequestedWebApps;
	readonly addonIds: ReadonlyArray<string>;
}

export class AdoptionRefusal extends Schema.TaggedError<AdoptionRefusal>()(
	"AdoptionRefusal",
	{ message: Schema.String },
) {}

export const primaryWebAppRefusal =
	"We couldn't choose a primary web app because apps/web isn't being adopted. Run forge init interactively and choose one.";

const portPatterns = [
	/--port[=\s]+(\d+)/g,
	/(?:^|\s)-p\s*(\d+)/g,
	/\bPORT=(\d+)/g,
];

function namedPorts(command: string | undefined): ReadonlyArray<number> {
	return [
		...new Set(
			portPatterns.flatMap((pattern) =>
				[...(command ?? "").matchAll(pattern)].map((match) => Number(match[1])),
			),
		),
	];
}

export function scriptPort(
	scripts: Readonly<Record<string, string>> | undefined,
): ScriptPort {
	const dev = namedPorts(scripts?.dev);
	const start = namedPorts(scripts?.start);
	if (dev.length > 1 || start.length > 1)
		return { kind: "ambiguous", dev, start };

	const [devPort] = dev;
	const [startPort] = start;
	if (devPort !== undefined && startPort !== undefined && devPort !== startPort)
		return { kind: "conflict", dev: devPort, start: startPort };

	const port = devPort ?? startPort;
	return port === undefined ? { kind: "absent" } : { kind: "literal", port };
}

export function webRoots(
	confirmed: ReadonlyArray<ConfirmedModule>,
): ReadonlyArray<string> {
	return confirmed
		.filter((module) => module.kind === "web-app")
		.map((module) => module.root);
}

export function primaryWebRoot(
	roots: ReadonlyArray<string>,
): string | undefined {
	if (roots.includes("apps/web")) return "apps/web";
	return roots.length === 1 ? roots[0] : undefined;
}

function label(framework: WebFramework) {
	return webFrameworks.label(framework);
}

function refuse(message: string) {
	return new AdoptionRefusal({ message });
}

function observedFramework(
	root: string,
	observation: WebAppObservation | undefined,
) {
	const frameworks = observation?.frameworks ?? [];
	const [framework, ...others] = frameworks;
	if (framework === undefined)
		return Effect.fail(
			refuse(
				`We couldn't adopt ${root} as a web app because we found no supported web framework in its dependencies.`,
			),
		);

	if (others.length > 0)
		return Effect.fail(
			refuse(
				`We couldn't adopt ${root} because we found ${listAnd.format(frameworks.map(label))} in its dependencies, and Forge manages one web framework per app.`,
			),
		);

	return Effect.succeed(framework);
}

function appName(
	observation: WebAppObservation,
	addonIds: ReadonlyArray<string>,
) {
	const name =
		observation.packageName?.split("/").at(-1) ?? basename(observation.root);

	const issue = webAppNameRuleIssue(name) ?? webAppNameIssue(name, addonIds);
	if (issue === undefined) return Effect.succeed(name);

	const fix =
		observation.packageName === undefined
			? `Forge names a web app after its package, so give ${observation.root} a package name and run forge init again.`
			: `Forge names a web app after its package, so rename ${observation.packageName} and run forge init again.`;

	return Effect.fail(
		refuse(`We couldn't adopt ${observation.root}: ${issue} ${fix}`),
	);
}

function portsPhrase(ports: ReadonlyArray<number>) {
	return ports.length === 1
		? `port ${ports[0]}`
		: `ports ${listAnd.format(ports.map(String))}`;
}

const portScripts: ReadonlyArray<PortScript> = ["dev", "start"];
function namedPortsClause(observed: {
	readonly dev: ReadonlyArray<number>;
	readonly start: ReadonlyArray<number>;
}) {
	const naming = portScripts
		.map((script) => ({ script, ports: observed[script] }))
		.filter(({ ports }) => ports.length > 0);

	const [only, ...others] = naming;
	if (only !== undefined && others.length === 0)
		return `its ${only.script} script names several ports, ${listAnd.format(only.ports.map(String))}`;

	return naming
		.map(
			({ script, ports }) => `its ${script} script names ${portsPhrase(ports)}`,
		)
		.join(" and ");
}

function appPort(
	root: string,
	observed: ScriptPort,
	requested: number | undefined,
) {
	if (observed.kind === "conflict")
		return Effect.fail(
			refuse(
				`We couldn't adopt ${root} because its dev script uses port ${observed.dev} but its start script uses port ${observed.start}. Use one port in both and run forge init again.`,
			),
		);

	if (observed.kind === "ambiguous")
		return requested !== undefined &&
			[...observed.dev, ...observed.start].includes(requested)
			? Effect.succeed(requested)
			: Effect.fail(
					refuse(
						`We couldn't adopt ${root} because ${namedPortsClause(observed)}, and Forge can't tell which one the app serves on. Set webApps[].port in the init config to that port and run forge init again.`,
					),
				);

	if (
		observed.kind === "literal" &&
		requested !== undefined &&
		observed.port !== requested
	)
		return Effect.fail(
			refuse(
				`We couldn't adopt ${root} because its scripts use port ${observed.port} but your init config sets port ${requested}. Make them match and run forge init again.`,
			),
		);

	const port =
		requested ?? (observed.kind === "literal" ? observed.port : undefined);

	if (port === undefined)
		return Effect.fail(
			refuse(
				`We couldn't adopt ${root} because its dev and start scripts name no port. Put a literal port in its dev script or set webApps[].port in the init config.`,
			),
		);

	return Effect.succeed(port);
}

const resolveSecondary = Effect.fn("resolveSecondary")(function* (
	observation: WebAppObservation,
	framework: WebFramework,
	input: WebAppAdoptionInput,
) {
	const name = yield* appName(observation, input.addonIds);
	const requested = input.requested.webApps?.find((app) => app.name === name);
	if (requested !== undefined && requested.framework !== framework)
		return yield* refuse(
			`We couldn't adopt ${observation.root} as ${label(requested.framework)} because its dependencies say ${label(framework)}. Fix webApps in your init config and run forge init again.`,
		);

	const port = yield* appPort(
		observation.root,
		observation.scriptPort,
		requested?.port,
	);

	const adoptedRpcRoots = input.confirmed
		.filter((module) => module.kind === "trpc" || module.kind === "orpc")
		.map((module) => module.root);

	const client =
		observation.rpcPackages.some((root) => adoptedRpcRoots.includes(root)) ||
		requested?.client === true;

	return {
		root: observation.root,
		...(observation.packageName === undefined
			? {}
			: { packageName: observation.packageName }),
		app: {
			name,
			framework,
			port,
			...(client ? { client: true } : {}),
		} satisfies AdoptedWebApp,
	} satisfies AdoptedSecondary;
});

function portRefusal(issue: string | undefined) {
	return issue === undefined
		? undefined
		: refuse(
				`We couldn't adopt these web apps: ${issue} Give each app its own port in its dev script and run forge init again.`,
			);
}

function canonicalRootRefusal(
	secondaries: ReadonlyArray<AdoptedSecondary>,
	confirmed: ReadonlyArray<ConfirmedModule>,
) {
	const adoptedRoots = new Set(confirmed.map((module) => module.root));
	const conflicts = secondaries.filter(
		(secondary) =>
			secondary.root !== `apps/${secondary.app.name}` &&
			adoptedRoots.has(`apps/${secondary.app.name}`),
	);

	if (conflicts.length === 0) return undefined;

	const canonical = conflicts.map(({ app }) => `apps/${app.name}`);
	const verb = conflicts.length === 1 ? "is another app" : "are other apps";
	const treated = conflicts.map(({ app }) => `apps/${app.name} as ${app.name}`);
	return refuse(
		`We couldn't adopt ${listAnd.format(conflicts.map(({ root, app }) => `${root} as ${app.name}`))} because ${listAnd.format(canonical)} ${verb} you're adopting, and on the next update Forge would treat ${listAnd.format(treated)}. Rename the package at ${listAnd.format(conflicts.map(({ root }) => root))} or move each app to apps/<its name>, then run forge init again.`,
	);
}

function unmatchedEntriesRefusal(
	secondaries: ReadonlyArray<AdoptedSecondary>,
	requested: RequestedWebApps,
) {
	const names = secondaries.map(({ app }) => app.name);
	const unmatched = (requested.webApps ?? [])
		.map((app) => app.name)
		.filter((name) => !names.includes(name));

	if (unmatched.length === 0) return undefined;

	const subject = unmatched.length === 1 ? "that name" : "those names";
	const adopted =
		names.length === 0
			? "Forge isn't adopting any secondary web app here."
			: `Forge names the adopted secondary web apps ${listAnd.format(names)}, after their packages.`;

	return refuse(
		`Your init config lists ${listAnd.format(unmatched)} under webApps, but no web app being adopted has ${subject}. ${adopted} Fix webApps in your init config and run forge init again.`,
	);
}

export const resolveWebAppAdoption = Effect.fn("resolveWebAppAdoption")(
	function* (input: WebAppAdoptionInput) {
		const roots = new Set(webRoots(input.confirmed));
		if (roots.size === 0) {
			const unmatched = unmatchedEntriesRefusal([], input.requested);
			if (unmatched !== undefined) return yield* unmatched;

			const resolved: ResolvedWebApps = {
				webApps: [],
				secondaries: [],
				prototypeRoots: new Map<string, string>(),
			};

			return resolved;
		}

		const primaryRoot = input.primaryRoot;
		if (primaryRoot === undefined || !roots.has(primaryRoot))
			return yield* refuse(primaryWebAppRefusal);

		const frameworks = new Map<string, WebFramework>();
		for (const root of roots)
			frameworks.set(
				root,
				yield* observedFramework(
					root,
					input.observations.find((observation) => observation.root === root),
				),
			);

		const web = frameworks.get(primaryRoot);
		if (web === undefined) return yield* refuse(primaryWebAppRefusal);

		const secondaries: Array<AdoptedSecondary> = [];
		for (const observation of input.observations) {
			const framework = frameworks.get(observation.root);
			if (framework === undefined || observation.root === primaryRoot) continue;
			secondaries.push(yield* resolveSecondary(observation, framework, input));
		}

		for (const secondary of secondaries) {
			const sharing = secondaries.filter(
				(candidate) => candidate.app.name === secondary.app.name,
			);

			if (sharing.length > 1)
				return yield* refuse(
					`We couldn't adopt ${listAnd.format(sharing.map((candidate) => candidate.root))} because each would be the web app named ${secondary.app.name}. Rename one package and run forge init again.`,
				);
		}

		const requestedNames =
			input.requested.webApps?.map((app) => app.name) ?? [];

		const ordered = [
			...requestedNames.flatMap((name) =>
				secondaries.filter((secondary) => secondary.app.name === name),
			),
			...secondaries.filter(
				(secondary) => !requestedNames.includes(secondary.app.name),
			),
		];

		const webApps = ordered.map((secondary) => secondary.app);
		const detectedName = basename(primaryRoot);
		const nameIssue =
			webAppNameRuleIssue(detectedName) ??
			webAppNameIssue(detectedName, input.addonIds) ??
			webAppNamesIssue({ web, webName: detectedName, webApps });

		const claimsAdoptedRoot = input.confirmed.some(
			(module) =>
				module.root === `apps/${detectedName}` && module.root !== primaryRoot,
		);

		const webName =
			nameIssue === undefined && !claimsAdoptedRoot && detectedName !== "web"
				? detectedName
				: undefined;

		const primaryName = primaryWebAppName({ webName });
		const decoded = Schema.decodeUnknownResult(webAppsSchema)(webApps);
		const primaryScriptPort = input.observations.find(
			(observation) => observation.root === primaryRoot,
		)?.scriptPort;

		const sharingPrimaryPort =
			primaryScriptPort?.kind === "literal"
				? webApps.find((app) => app.port === primaryScriptPort.port)
				: undefined;

		const projectNameIssue = webAppNamesIssue({ web, webName, webApps });
		const refusal =
			unmatchedEntriesRefusal(ordered, input.requested) ??
			canonicalRootRefusal(ordered, input.confirmed) ??
			(projectNameIssue === undefined
				? undefined
				: refuse(`We couldn't adopt these web apps: ${projectNameIssue}`)) ??
			portRefusal(
				Result.isFailure(decoded)
					? formatSchemaError(decoded.failure, webApps)[0]?.message
					: sharingPrimaryPort === undefined
						? undefined
						: `${primaryName} and ${sharingPrimaryPort.name} both use port ${sharingPrimaryPort.port}.`,
			);

		if (refusal !== undefined) return yield* refusal;

		const resolved: ResolvedWebApps = {
			web,
			...(webName === undefined ? {} : { webName }),
			webApps,
			secondaries: ordered,
			prototypeRoots: new Map([
				[primaryRoot, `apps/${primaryName}`],
				...ordered.map((secondary): [string, string] => [
					secondary.root,
					`apps/${secondary.app.name}`,
				]),
			]),
		};

		return resolved;
	},
);

function bindsByIdentity(secondary: AdoptedSecondary, slug: string) {
	return (
		secondary.root === `apps/${secondary.app.name}` ||
		secondary.packageName === `@${slug}/${secondary.app.name}`
	);
}

export interface AdoptionContext {
	readonly slug: string;
	readonly slugGuessed?: boolean;
	readonly backend?: unknown;
}

function unboundRefusal(
	secondaries: ReadonlyArray<AdoptedSecondary>,
	context: AdoptionContext,
) {
	const { slug } = context;
	const unbound = secondaries.filter(
		(secondary) =>
			!bindsByIdentity(secondary, slug) &&
			secondaries.some(
				(other) =>
					other !== secondary &&
					other.app.framework === secondary.app.framework &&
					!bindsByIdentity(other, slug),
			),
	);

	if (unbound.length === 0) return undefined;

	const lookups = unbound.map(
		({ app }) => `${app.name} at apps/${app.name} or as @${slug}/${app.name}`,
	);

	const guessed =
		context.slugGuessed === true
			? ` Forge guessed the slug ${slug}. To use another, set slug in an init config and pass it with --config.`
			: "";

	return refuse(
		`We couldn't adopt ${listAnd.format(unbound.map((secondary) => secondary.root))} because Forge tells web apps of the same framework apart only by their folder or package, and these match neither. On the next update it would look for ${listAnd.format(lookups)}. Move each app to apps/<its name> or rename its package to @${slug}/<its name>, then run forge init again.${guessed}`,
	);
}

// The planner rebinds an unmatched app only while it is the single unbound candidate of its template.
export function adoptionRefusal(
	resolved: ResolvedWebApps,
	context: AdoptionContext,
) {
	if (resolved.web === undefined) return undefined;

	const unbound = unboundRefusal(resolved.secondaries, context);
	if (unbound !== undefined) return unbound;

	const port = webDevPort(resolved.web);
	const secondary = resolved.secondaries.find(({ app }) => app.port === port);
	if (secondary !== undefined)
		return refuse(
			`We couldn't adopt ${secondary.root} on port ${port} because Forge runs the primary web app on port ${port}. Give ${secondary.root} another port in its dev script and run forge init again.`,
		);

	const backend = backends.normalize(context.backend);
	return portRefusal(
		webAppPortIssue({
			web: resolved.web,
			webName: resolved.webName,
			webApps: resolved.webApps,
			...(backend === undefined ? {} : { backend }),
		}),
	);
}

export function rpcProviderRefusal(confirmed: ReadonlyArray<ConfirmedModule>) {
	const trpc = confirmed.find((module) => module.kind === "trpc");
	const orpc = confirmed.find((module) => module.kind === "orpc");
	if (trpc === undefined || orpc === undefined) return undefined;

	return refuse(
		`We couldn't adopt ${trpc.root} and ${orpc.root} together: one uses @trpc/server and the other @orpc/server, and Forge manages one RPC provider. Adopt only one of them, with rpc set to match in an init config, then run forge init again.`,
	);
}

const webPlatforms: readonly ["web"] = ["web"];
export function adoptedWebConfig(
	resolved: ResolvedWebApps,
	requested: Readonly<Record<string, unknown>>,
) {
	return {
		...(resolved.web === undefined
			? {}
			: {
					web: resolved.web,
					...(resolved.webName === undefined
						? {}
						: { webName: resolved.webName }),
					...(requested.platforms === undefined
						? { platforms: webPlatforms }
						: {}),
				}),
		...(resolved.webApps.length > 0 || requested.webApps !== undefined
			? { webApps: resolved.webApps }
			: {}),
	};
}

function describeWebApp(app: WebAppConfig) {
	const details = [
		label(app.framework),
		...(app.port === undefined ? [] : [`port ${app.port}`]),
		...(app.client === true ? ["calls the API"] : []),
	];

	return `${app.name} (${details.join(", ")})`;
}

export function secondaryWebAppsSentence(
	webApps: ReadonlyArray<WebAppConfig> | undefined,
): string | undefined {
	if (webApps === undefined || webApps.length === 0) return undefined;

	const subject =
		webApps.length === 1 ? "a secondary web app" : "secondary web apps";

	return `We'll adopt ${listAnd.format(webApps.map(describeWebApp))} as ${subject}.`;
}
