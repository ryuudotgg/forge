import { parseArgs } from "node:util";
import { packageManagers, runtimes } from "@ryuugg/core";
import type { Platform } from "@ryuugg/generators";
import {
	authenticationProviders,
	backends,
	catalogs,
	databaseProviders,
	databases,
	desktopFrameworks,
	emailProviders,
	linters,
	mobileFrameworks,
	nativeStyleFrameworks,
	orms,
	rpcProviders,
	styleFrameworks,
	type WebAppConfig,
	type WebFramework,
	webFrameworks,
} from "@ryuugg/generators";
import { Result, Schema } from "effect";
import type { ParsedValues, SubcommandDef } from "./commands/registry";
import {
	firstPartyAddonIds,
	webAppNameIssue,
	webAppsIssueMessage,
	webAppsSchema,
} from "./steps/platforms/web-apps";
import type { PartialConfig } from "./steps/types";
import type { Choices } from "./utils/choices";
import { listAnd, listOr } from "./utils/list";

interface CLIOption {
	type: "string" | "boolean";
	description?: string;
	choices?: Choices<string>;

	short?: string;
	configKey?: string;
	platform?: Platform;
	multiple?: boolean;
}

function environmentChoices(
	values: Readonly<Record<string, { readonly displayName: string }>>,
): Choices<string> {
	const fold = (value: string) => value.normalize("NFKC").toLowerCase();
	const byValue = new Map<string, string>();
	for (const [key, { displayName }] of Object.entries(values)) {
		byValue.set(fold(key), displayName);
		byValue.set(fold(displayName), displayName);
	}

	return {
		ids: Object.values(values).map(({ displayName }) => displayName),
		available: () => true,
		label: (id) => id,
		normalize: (value) =>
			typeof value === "string" ? byValue.get(fold(value)) : undefined,
	};
}

export function decodeChoice<Id extends string>(
	table: Choices<Id>,
	value: unknown,
	source: { flag: string } | { configKey: string },
): Id {
	const id = table.normalize(value);
	const choices = listOr.format(
		table.ids
			.filter((choice) => table.available(choice))
			.map((choice) => table.label(choice)),
	);
	if (id === undefined)
		throw new Error(
			"flag" in source
				? `${source.flag} takes ${choices}, not ${JSON.stringify(value)}.`
				: `Your config file sets ${JSON.stringify(source.configKey)} to ${JSON.stringify(value)}, but it takes ${choices}.`,
		);

	if (!table.available(id)) {
		const name =
			"flag" in source
				? source.flag
				: `${JSON.stringify(source.configKey)} in your config file`;
		throw new Error(
			`We don't support ${table.label(id)} for ${name} yet, so pick ${choices}.`,
		);
	}

	return id;
}

export type OptionKey = keyof typeof options;

interface CLISection {
	title: string;
	keys: OptionKey[];
	descriptions?: Partial<Record<OptionKey, string>>;
}

export const options = {
	help: { type: "boolean", short: "h", description: "You're looking at it!" },
	version: {
		type: "boolean",
		short: "v",
		description: "Returns the current version of Forge.",
	},

	kind: {
		type: "string",
		description: "Filter the catalog by addon, framework, or template.",
	},

	json: {
		type: "boolean",
		description: "Print stable version 1 JSON; fields are added only.",
	},

	"first-party": {
		type: "boolean",
		description:
			"Skip project registries and show only the first-party catalog.",
	},

	config: {
		type: "string",
		short: "c",
		description: "Use a JSON Config File.",
	},

	preset: {
		type: "string",
		short: "p",
		description: "Start from a named preset configuration.",
	},

	name: {
		type: "string",
		description: "A name for the project.",
		configKey: "name",
	},
	client: {
		type: "boolean",
		description: "Mark the new secondary web app as an API client.",
	},

	path: {
		type: "string",
		description: "Where you want the project to be created.",
		configKey: "path",
	},

	runtime: {
		type: "string",
		choices: environmentChoices(runtimes),
		configKey: "runtime",
	},

	"package-manager": {
		type: "string",
		choices: environmentChoices(packageManagers),
		configKey: "packageManager",
	},

	catalogs: {
		type: "string",
		choices: catalogs,
		configKey: "catalogs",
	},

	linter: {
		type: "string",
		choices: linters,
		configKey: "linter",
	},

	web: {
		type: "string",
		multiple: true,
		description:
			"Repeat per app: framework, name=framework, or name=framework+client.",
		choices: webFrameworks,
		configKey: "web",
	},

	desktop: {
		type: "string",
		choices: desktopFrameworks,
		configKey: "desktop",
		platform: "desktop",
	},

	mobile: {
		type: "string",
		choices: mobileFrameworks,
		configKey: "mobile",
		platform: "mobile",
	},

	backend: {
		type: "string",
		choices: backends,
		configKey: "backend",
	},

	rpc: {
		type: "string",
		choices: rpcProviders,
		configKey: "rpc",
	},

	database: {
		type: "string",
		choices: databases,
		configKey: "database",
	},

	orm: {
		type: "string",
		choices: orms,
		configKey: "orm",
	},

	auth: {
		type: "string",
		choices: authenticationProviders,
		configKey: "authentication",
	},
	email: {
		type: "string",
		choices: emailProviders,
		configKey: "emailProvider",
	},

	"database-provider": {
		type: "string",
		choices: databaseProviders,
		configKey: "databaseProvider",
	},

	style: {
		type: "string",
		choices: styleFrameworks,
		configKey: "style",
	},

	"native-style": {
		type: "string",
		choices: nativeStyleFrameworks,
		configKey: "nativeStyleFramework",
		platform: "mobile",
	},

	"no-install": {
		type: "boolean",
		description: "Do not install dependencies.",
	},

	"no-git": {
		type: "boolean",
		description: "Do not initialize a Git repository.",
	},

	"keep-user": {
		type: "boolean",
		description: "Keep your values when resolving conflicts.",
	},

	"accept-forge": {
		type: "boolean",
		description: "Take Forge's values when resolving conflicts.",
	},

	"dry-run": {
		type: "boolean",
		description: "Preview adoption without writing files.",
	},

	reconcile: {
		type: "boolean",
		description: "Reconcile the project immediately after adoption.",
	},

	yes: {
		type: "boolean",
		description: "Accept detected defaults and proposed module mappings.",
	},
} as const satisfies Record<string, CLIOption>;

export const sections: CLISection[] = [
	{
		title: "Global options",
		keys: ["help", "version"],
	},
	{
		title: "forge [create] options",
		keys: [
			"config",
			"preset",
			"no-install",
			"no-git",
			"name",
			"path",
			"runtime",
			"package-manager",
			"catalogs",
			"linter",
			"web",
			"desktop",
			"mobile",
			"backend",
			"rpc",
			"database",
			"orm",
			"auth",
			"email",
			"database-provider",
			"style",
			"native-style",
		],
	},
	{
		title: "forge list/info options",
		keys: ["kind", "json", "first-party"],
	},
	{
		title: "forge init options",
		keys: ["dry-run", "reconcile", "yes"],
	},
	{
		title: "forge add/remove/update options",
		keys: ["keep-user", "accept-forge", "yes"],
		descriptions: {
			yes: "Install a new registry package without asking first.",
		},
	},
	{
		title: "forge add <framework> options",
		keys: ["name", "client"],
		descriptions: {
			name: "Name the secondary web app to add.",
		},
	},
];

export function getParseArgsOptions(): Record<
	string,
	{ type: "string" | "boolean"; short?: string; multiple: boolean }
> {
	const result: Record<
		string,
		{ type: "string" | "boolean"; short?: string; multiple: boolean }
	> = {};

	for (const [key, def] of Object.entries<CLIOption>(options)) {
		const entry: {
			type: "string" | "boolean";
			short?: string;
			multiple: boolean;
		} = {
			multiple: def.multiple ?? false,
			type: def.type,
		};

		if (def.short) entry.short = def.short;
		result[key] = entry;
	}

	return result;
}

const multipleOptionKeys = new Set(
	Object.entries<CLIOption>(options)
		.filter(([, option]) => option.multiple === true)
		.map(([key]) => key),
);

export function isParsedValues(values: unknown): values is ParsedValues {
	if (typeof values !== "object" || values === null) return false;
	return Object.entries(values).every(
		([key, value]) =>
			typeof value === "string" ||
			typeof value === "boolean" ||
			(multipleOptionKeys.has(key) &&
				Array.isArray(value) &&
				value.every((entry: unknown) => typeof entry === "string")),
	);
}

export function validateParsedArgs(parsed: {
	readonly positionals: string[];
	readonly values: unknown;
}): {
	positionals: string[];
	values: ParsedValues;
} {
	if (!isParsedValues(parsed.values))
		throw new Error(
			"CLI Args Invalid: option values must be strings or booleans.",
		);

	return { positionals: parsed.positionals, values: parsed.values };
}

export function parseCliArgs(args: readonly string[]): {
	positionals: string[];
	values: ParsedValues;
} {
	const parsed = parseArgs({
		options: getParseArgsOptions(),
		allowPositionals: true,
		args,
		strict: true,
	});

	return validateParsedArgs(parsed);
}

export function findOptionMissingValue(
	args: readonly string[],
): string | undefined {
	const parseOptions = getParseArgsOptions();
	const { tokens } = parseArgs({
		options: parseOptions,
		allowPositionals: true,
		args,
		strict: false,
		tokens: true,
	});

	for (const token of tokens) {
		if (token.kind !== "option" || parseOptions[token.name]?.type !== "string")
			continue;

		if (
			token.value === undefined ||
			(token.value.startsWith("-") && token.inlineValue === false)
		)
			return token.rawName;
	}

	return undefined;
}

export function isUnknownCommand(
	subcommand: string | undefined,
	command: SubcommandDef | undefined,
): boolean {
	return subcommand !== undefined && command === undefined;
}

const clientSuffix = "+client";

function webFlagFramework(framework: string): WebFramework {
	return decodeChoice(webFrameworks, framework, { flag: "--web" });
}

function webFlagOverrides(entries: ReadonlyArray<string>): PartialConfig {
	const primaries: string[] = [];
	const apps: WebAppConfig[] = [];
	for (const entry of entries) {
		if (entry === "")
			throw new Error("--web needs a framework, like --web nextjs.");

		const separator = entry.indexOf("=");
		if (separator === -1) {
			if (entry.endsWith(clientSuffix))
				throw new Error(
					`Only a named web app can be an API client, like admin=${entry}.`,
				);

			primaries.push(entry);
			continue;
		}

		const name = entry.slice(0, separator);
		if (name === "")
			throw new Error(
				`--web ${entry} needs a web app name before the equals sign, like admin${entry}.`,
			);

		const value = entry.slice(separator + 1);
		const client = value.endsWith(clientSuffix);
		const framework = client ? value.slice(0, -clientSuffix.length) : value;
		if (framework === "")
			throw new Error(
				`--web ${entry} needs a framework after the equals sign, like ${name}=nextjs.`,
			);

		apps.push({
			name,
			framework: webFlagFramework(framework),
			...(client ? { client: true } : {}),
		});
	}

	if (primaries.length > 1)
		throw new Error(
			`--web takes one bare framework for the primary web app, but got ${listAnd.format(primaries)}. Name the others, like admin=${primaries[1]}.`,
		);

	const primary = primaries[0];
	const web = primary === undefined ? undefined : webFlagFramework(primary);

	const result = Schema.decodeResult(webAppsSchema)(apps);
	if (Result.isFailure(result))
		throw new Error(webAppsIssueMessage(result.failure));

	const addonIds = firstPartyAddonIds();
	for (const app of result.success) {
		const issue = webAppNameIssue(app.name, addonIds);
		if (issue !== undefined) throw new Error(issue);
	}

	return {
		...(web === undefined ? {} : { web }),
		...(result.success.length === 0 ? {} : { webApps: result.success }),
	};
}

export function buildFlagOverrides(values: ParsedValues): PartialConfig {
	const overrides: PartialConfig = {};
	for (const [key, opt] of Object.entries<CLIOption>(options)) {
		const configKey = opt.configKey;
		if (!configKey) continue;

		const value = values[key];
		if (key === "web" && value !== undefined) {
			const entries = typeof value === "string" ? [value] : value;
			if (!Array.isArray(entries))
				throw new Error(
					"CLI Args Invalid: web must contain frameworks or name=framework entries.",
				);

			Object.assign(overrides, webFlagOverrides(entries));
			continue;
		}

		if (value !== undefined)
			overrides[configKey] = opt.choices
				? decodeChoice(opt.choices, value, { flag: `--${key}` })
				: value;
	}

	return overrides;
}
