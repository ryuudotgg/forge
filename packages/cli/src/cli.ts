import { parseArgs } from "node:util";
import { packageManagers, runtimes } from "@ryuujs/core";
import type { Platform } from "@ryuujs/generators";
import {
	authenticationProviders,
	backends,
	catalogs,
	databaseProviders,
	databases,
	desktopFrameworks,
	linters,
	mobileFrameworks,
	nativeStyleFrameworks,
	orms,
	rpcProviders,
	styleFrameworks,
	webFrameworks,
} from "@ryuujs/generators";
import type { ParsedValues, SubcommandDef } from "./commands/registry";
import type { PartialConfig } from "./steps/types";

interface CLIOption {
	type: "string" | "boolean";
	description?: string;
	choices?: ReadonlyArray<CLIChoice>;

	short?: string;
	configKey?: string;
	platform?: Platform;
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
			"database-provider",
			"style",
			"native-style",
		],
	},
	{
		title: "forge list/info options",
		keys: ["kind", "json"],
	},
];

export function getParseArgsOptions(): Record<
	string,
	{ type: "string" | "boolean"; short?: string; multiple: false }
> {
	const result: Record<
		string,
		{ type: "string" | "boolean"; short?: string; multiple: false }
	> = {};

	for (const [key, def] of Object.entries<CLIOption>(options)) {
		const entry: {
			type: "string" | "boolean";
			short?: string;
			multiple: false;
		} = {
			multiple: false,
			type: def.type,
		};

		if (def.short) entry.short = def.short;
		result[key] = entry;
	}

	return result;
}

function isParsedValues(values: unknown): values is ParsedValues {
	if (typeof values !== "object" || values === null) return false;
	return Object.values(values).every(
		(value) => typeof value === "string" || typeof value === "boolean",
	);
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

	if (!isParsedValues(parsed.values))
		throw new Error(
			"CLI Args Invalid: option values must be strings or booleans.",
		);

	return parsed;
}

export function isUnknownCommand(
	subcommand: string | undefined,
	command: SubcommandDef | undefined,
): boolean {
	return subcommand !== undefined && command === undefined;
}

export function buildFlagOverrides(
	values: Record<string, string | boolean | undefined>,
): PartialConfig {
	const overrides: PartialConfig = {};

	for (const [key, opt] of Object.entries<CLIOption>(options)) {
		const configKey = opt.configKey;
		if (!configKey) continue;

		const value = values[key];
		if (value !== undefined) overrides[configKey] = value;
	}

	return overrides;
}
