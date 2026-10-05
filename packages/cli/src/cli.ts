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
	webFrameworks,
} from "@ryuugg/generators";
import { Result, Schema } from "effect";
import type { ParsedValues, SubcommandDef } from "./commands/registry";
import { webSchema } from "./steps/platforms/web";
import {
	firstPartyAddonIds,
	webAppNameIssue,
	webAppsSchema,
} from "./steps/platforms/web-apps";
import type { PartialConfig } from "./steps/types";

interface CLIOption {
	type: "string" | "boolean";
	description?: string;
	choices?: ReadonlyArray<CLIChoice>;

	short?: string;
	configKey?: string;
	platform?: Platform;
	multiple?: boolean;
}

interface CLIChoice {
	readonly available: boolean;
	readonly label: string;
}

function choiceHint<Id extends string>(choices: {
	readonly ids: ReadonlyArray<Id>;
	available(id: Id): boolean;
	label(id: Id): string;
}): ReadonlyArray<CLIChoice> {
	return choices.ids.map((id) => ({
		available: choices.available(id),
		label: choices.label(id),
	}));
}

function environmentHint(
	values: ReadonlyArray<{ readonly displayName: string }>,
): ReadonlyArray<CLIChoice> {
	return values.map(({ displayName }) => ({
		available: true,
		label: displayName,
	}));
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
		choices: environmentHint(Object.values(runtimes)),
		configKey: "runtime",
	},

	"package-manager": {
		type: "string",
		choices: environmentHint(Object.values(packageManagers)),
		configKey: "packageManager",
	},

	catalogs: {
		type: "string",
		choices: choiceHint(catalogs),
		configKey: "catalogs",
	},

	linter: {
		type: "string",
		choices: choiceHint(linters),
		configKey: "linter",
	},

	web: {
		type: "string",
		multiple: true,
		description:
			"Repeat with a framework for web or name=framework for another app.",
		choices: choiceHint(webFrameworks),
		configKey: "web",
	},

	desktop: {
		type: "string",
		choices: choiceHint(desktopFrameworks),
		configKey: "desktop",
		platform: "desktop",
	},

	mobile: {
		type: "string",
		choices: choiceHint(mobileFrameworks),
		configKey: "mobile",
		platform: "mobile",
	},

	backend: {
		type: "string",
		choices: choiceHint(backends),
		configKey: "backend",
	},

	rpc: {
		type: "string",
		choices: choiceHint(rpcProviders),
		configKey: "rpc",
	},

	database: {
		type: "string",
		choices: choiceHint(databases),
		configKey: "database",
	},

	orm: {
		type: "string",
		choices: choiceHint(orms),
		configKey: "orm",
	},

	auth: {
		type: "string",
		choices: choiceHint(authenticationProviders),
		configKey: "authentication",
	},
	email: {
		type: "string",
		choices: choiceHint(emailProviders),
		configKey: "emailProvider",
	},

	"database-provider": {
		type: "string",
		choices: choiceHint(databaseProviders),
		configKey: "databaseProvider",
	},

	style: {
		type: "string",
		choices: choiceHint(styleFrameworks),
		configKey: "style",
	},

	"native-style": {
		type: "string",
		choices: choiceHint(nativeStyleFrameworks),
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
		keys: ["keep-user", "accept-forge", "yes", "name", "client"],
		descriptions: {
			name: "Name the secondary web app to add.",
			yes: "Install a new registry package without asking first.",
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

export function isParsedValues(values: unknown): values is ParsedValues {
	if (typeof values !== "object" || values === null) return false;
	return Object.entries(values).every(
		([key, value]) =>
			typeof value === "string" ||
			typeof value === "boolean" ||
			(key === "web" &&
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

export function isUnknownCommand(
	subcommand: string | undefined,
	command: SubcommandDef | undefined,
): boolean {
	return subcommand !== undefined && command === undefined;
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

			const apps = [];
			for (const entry of entries) {
				const separator = entry.indexOf("=");
				const framework = separator === -1 ? entry : entry.slice(separator + 1);
				const normalized = webFrameworks.normalize(framework) ?? framework;
				if (separator === -1) {
					const result = Schema.decodeUnknownResult(webSchema)(normalized);
					if (Result.isFailure(result))
						throw new Error(`CLI Args Invalid: ${result.failure.message}`);

					overrides.web = result.success;
				} else
					apps.push({ name: entry.slice(0, separator), framework: normalized });
			}

			const result = Schema.decodeUnknownResult(webAppsSchema)(apps);
			if (Result.isFailure(result))
				throw new Error(`CLI Args Invalid: ${result.failure.message}`);

			const addonIds = firstPartyAddonIds();
			for (const app of result.success) {
				const issue = webAppNameIssue(app.name, addonIds);
				if (issue !== undefined) throw new Error(`CLI Args Invalid: ${issue}`);
			}

			if (result.success.length !== 0) overrides.webApps = result.success;

			continue;
		}

		if (value !== undefined) overrides[configKey] = value;
	}

	return overrides;
}
