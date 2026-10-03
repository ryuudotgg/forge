import {
	type AuthMethod,
	type AuthPlugin,
	authPlugins,
	type ForgeConfig,
} from "../config";
import { deps } from "../deps";
import { authUsesPasskey, resolveAuthMethods } from "./methods";
import { type AuthTable, passkeyTable } from "./tables";

export interface AuthField {
	readonly name: string;
	readonly type: "string" | "boolean" | "date";
	readonly unique?: true;
	readonly default?: false;
}

type AuthModel = "user" | "session";
type AuthPluginSide = "server" | "client" | "expo";
type AuthExtension = AuthPlugin | Extract<AuthMethod, "passkey">;
type AuthPackageSide = "auth" | "expo";

interface AuthPluginEnvEntry {
	readonly name: string;
	readonly schema: string;
	readonly runtime: string;
	readonly example: string;
}

interface AuthPluginPackage {
	readonly name: string;
	readonly version: string;
}

interface AuthPluginImport {
	readonly module: string;
	readonly name: string;
}

interface AuthPluginDefinition {
	readonly server: ReadonlyArray<AuthPluginImport>;
	readonly client: ReadonlyArray<AuthPluginImport>;
	readonly expo?: ReadonlyArray<AuthPluginImport>;
	readonly tables?: ReadonlyArray<AuthTable>;
	readonly files?: ReadonlyArray<string>;
	readonly requires?: AuthMethod;
	readonly fields: Partial<Record<AuthModel, ReadonlyArray<AuthField>>>;
	readonly env?: ReadonlyArray<AuthPluginEnvEntry>;
	readonly emitsNamelessTypes?: true;
	readonly packages?: Partial<
		Record<AuthPackageSide, ReadonlyArray<AuthPluginPackage>>
	>;
}

const authPluginDefinitions = {
	passkey: {
		server: [{ module: "./passkey", name: "passkeyPlugin" }],
		client: [{ module: "@better-auth/passkey/client", name: "passkeyClient" }],
		expo: [],
		fields: {},
		tables: [passkeyTable],
		files: ["src/passkey.ts"],
		packages: { auth: [deps.betterAuthPasskey] },
	},
	username: {
		server: [{ module: "better-auth/plugins", name: "username" }],
		client: [{ module: "better-auth/client/plugins", name: "usernameClient" }],
		requires: "email-password",
		fields: {
			user: [
				{ name: "username", type: "string", unique: true },
				{ name: "displayUsername", type: "string" },
			],
		},
	},
	admin: {
		server: [{ module: "better-auth/plugins", name: "admin" }],
		client: [{ module: "better-auth/client/plugins", name: "adminClient" }],
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
	polar: {
		files: ["src/polar.ts"],
		server: [
			{ module: "./polar", name: "polarPlugin" },
			{ module: "./polar", name: "polarAvailability" },
		],
		client: [{ module: "@polar-sh/better-auth/client", name: "polarClient" }],
		fields: {},
		emitsNamelessTypes: true,
		packages: {
			auth: [deps.polarBetterAuth, deps.polarSdk],
			expo: [deps.polarBetterAuth, deps.polarSdk],
		},
		env: [
			{
				name: "POLAR_ACCESS_TOKEN",
				schema: "z.string().trim().min(1).optional()",
				runtime: "process.env.POLAR_ACCESS_TOKEN",
				example: '""',
			},
			{
				name: "POLAR_WEBHOOK_SECRET",
				schema: "z.string().trim().min(1).optional()",
				runtime: "process.env.POLAR_WEBHOOK_SECRET",
				example: '""',
			},
			{
				name: "POLAR_SERVER",
				schema: 'z.enum(["sandbox", "production"]).optional()',
				runtime: "process.env.POLAR_SERVER",
				example: '"sandbox"',
			},
		],
	},
} satisfies Record<AuthExtension, AuthPluginDefinition>;

function activeAuthExtensions(
	config: ForgeConfig,
): ReadonlyArray<AuthExtension> {
	const plugins = resolveAuthPlugins(config);
	if (config.authentication !== "better-auth") return plugins;
	return authUsesPasskey(config) ? ["passkey", ...plugins] : plugins;
}

export function authPluginTables(
	config: ForgeConfig,
): ReadonlyArray<AuthTable> {
	return activeAuthExtensions(config).flatMap((extension) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[extension];
		return definition.tables ?? [];
	});
}

export function authPluginFiles(config: ForgeConfig): ReadonlyArray<string> {
	return activeAuthExtensions(config).flatMap((extension) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[extension];
		return definition.files ?? [];
	});
}

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
	return activeAuthExtensions(config).flatMap((extension) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[extension];
		return side === "expo"
			? (definition.expo ?? definition.client)
			: definition[side];
	});
}

export function authPluginsBlockDeclarations(config: ForgeConfig): boolean {
	return resolveAuthPlugins(config).some((plugin) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[plugin];
		return definition.emitsNamelessTypes === true;
	});
}

export function authPluginEnvEntries(
	config: ForgeConfig,
): ReadonlyArray<AuthPluginEnvEntry> {
	return resolveAuthPlugins(config).flatMap((plugin) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[plugin];
		return definition.env ?? [];
	});
}

export function authPluginPackages(
	config: ForgeConfig,
	side: AuthPackageSide,
): ReadonlyArray<AuthPluginPackage> {
	return activeAuthExtensions(config).flatMap((plugin) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[plugin];
		return definition.packages?.[side] ?? [];
	});
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
