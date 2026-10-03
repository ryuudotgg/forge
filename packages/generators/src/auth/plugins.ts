import {
	type AuthMethod,
	type AuthPlugin,
	authPlugins,
	type ForgeConfig,
} from "../config";
import { resolveAuthMethods } from "./methods";

export interface AuthField {
	readonly name: string;
	readonly type: "string" | "boolean" | "date";
	readonly unique?: true;
	readonly default?: false;
}

type AuthModel = "user" | "session";
type AuthPluginSide = "server" | "client";

interface AuthPluginImport {
	readonly module: string;
	readonly name: string;
}

interface AuthPluginDefinition {
	readonly server: AuthPluginImport;
	readonly client: AuthPluginImport;
	readonly requires?: AuthMethod;
	readonly fields: Partial<Record<AuthModel, ReadonlyArray<AuthField>>>;
}

const authPluginDefinitions = {
	username: {
		server: { module: "better-auth/plugins", name: "username" },
		client: { module: "better-auth/client/plugins", name: "usernameClient" },
		requires: "email-password",
		fields: {
			user: [
				{ name: "username", type: "string", unique: true },
				{ name: "displayUsername", type: "string" },
			],
		},
	},
	admin: {
		server: { module: "better-auth/plugins", name: "admin" },
		client: { module: "better-auth/client/plugins", name: "adminClient" },
		fields: {
			user: [
				{ name: "role", type: "string" },
				{ name: "banned", type: "boolean", default: false },
				{ name: "banReason", type: "string" },
				{ name: "banExpires", type: "date" },
			],
			session: [{ name: "impersonatedBy", type: "string" }],
		},
	},
} satisfies Record<AuthPlugin, AuthPluginDefinition>;

function isAuthPluginList(value: unknown): value is ReadonlyArray<AuthPlugin> {
	if (!Array.isArray(value)) return false;

	const plugins: ReadonlyArray<unknown> = value;
	for (const plugin of plugins)
		if (!authPlugins.ids.some((id) => id === plugin)) return false;

	return true;
}

function selectedAuthPlugins(config: ForgeConfig): ReadonlyArray<AuthPlugin> {
	if (config.authentication !== "better-auth") return [];
	if (config.authPlugins === undefined) return [];
	if (!isAuthPluginList(config.authPlugins))
		throw new Error(
			`Invalid Auth Plugins: ${JSON.stringify(config.authPlugins)}`,
		);

	return authPlugins.ids.filter((id) => config.authPlugins?.includes(id));
}

export function authPluginRequirement(
	plugin: AuthPlugin,
): AuthMethod | undefined {
	const definition: AuthPluginDefinition = authPluginDefinitions[plugin];
	return definition.requires;
}

export function unmetAuthPluginRequirements(
	config: ForgeConfig,
): ReadonlyArray<AuthPlugin> {
	const plugins = selectedAuthPlugins(config);
	if (plugins.length === 0) return [];

	const methods = resolveAuthMethods(config);
	return plugins.filter((plugin) => {
		const required = authPluginRequirement(plugin);
		return required !== undefined && !methods.includes(required);
	});
}

export function resolveAuthPlugins(
	config: ForgeConfig,
): ReadonlyArray<AuthPlugin> {
	const plugins = selectedAuthPlugins(config);
	const missing = unmetAuthPluginRequirements(config)[0];
	if (missing !== undefined)
		throw new Error(`Auth Plugin Requirement: ${missing}`);

	return plugins;
}

export function authPluginFields(
	config: ForgeConfig,
	model: AuthModel,
): ReadonlyArray<AuthField> {
	return resolveAuthPlugins(config).flatMap((plugin) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[plugin];
		return definition.fields[model] ?? [];
	});
}

export function authPluginBindings(
	config: ForgeConfig,
	side: AuthPluginSide,
): ReadonlyArray<AuthPluginImport> {
	return resolveAuthPlugins(config).map(
		(plugin) => authPluginDefinitions[plugin][side],
	);
}

export function authPluginImports(
	bindings: ReadonlyArray<AuthPluginImport>,
): string {
	const modules = new Map<string, Set<string>>();
	for (const binding of bindings) {
		const names = modules.get(binding.module) ?? new Set<string>();
		names.add(binding.name);
		modules.set(binding.module, names);
	}

	return [...modules]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([module, names]) => {
			const sortedNames = [...names].sort();
			const singleLine = `import { ${sortedNames.join(", ")} } from "${module}";`;
			return singleLine.length <= 80
				? `${singleLine}\n`
				: `import {\n${sortedNames.map((name) => `  ${name},`).join("\n")}\n} from "${module}";\n`;
		})
		.join("");
}
