import { Refusal } from "@ryuugg/core";
import {
	type AuthMethod,
	type AuthPlugin,
	authMethods,
	authPlugins,
	type ForgeConfig,
} from "../config";
import { deps } from "../deps";
import { organizationServerCall } from "./invitations";
import { authEmailMethods, authUsesEmail, resolveAuthMethods } from "./methods";
import {
	type AuthTable,
	organizationTables,
	passkeyTable,
	twoFactorTable,
} from "./tables";

const listAnd = new Intl.ListFormat("en", { type: "conjunction" });
const listOr = new Intl.ListFormat("en", { type: "disjunction" });

export interface AuthField {
	readonly name: string;
	readonly type: "string" | "boolean" | "date";
	readonly unique?: true;
	readonly default?: false;
}

export type AuthFieldGroup = readonly [AuthField, ...ReadonlyArray<AuthField>];

type AuthModel = "user" | "session";
type AuthPluginSide = "server" | "client" | "expo";
type AuthExtension =
	| AuthPlugin
	| Extract<AuthMethod, "passkey" | "email-otp" | "magic-link">;

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
	readonly call?: string;
}

export interface AuthPluginDefinition {
	readonly server:
		| ReadonlyArray<AuthPluginImport>
		| ((config: ForgeConfig) => ReadonlyArray<AuthPluginImport>);
	readonly client: ReadonlyArray<AuthPluginImport>;
	readonly expo?: ReadonlyArray<AuthPluginImport>;
	readonly tables?: ReadonlyArray<AuthTable>;
	readonly files?: ReadonlyArray<string>;
	readonly requires?: AuthMethod;
	readonly fields?: Partial<Record<AuthModel, AuthFieldGroup>>;
	readonly env?: ReadonlyArray<AuthPluginEnvEntry>;
	readonly emitsNamelessTypes?: true;
	readonly packages?: Partial<
		Record<AuthPackageSide, ReadonlyArray<AuthPluginPackage>>
	>;
}

export const authPluginDefinitions = {
	"two-factor": {
		server: [{ module: "better-auth/plugins", name: "twoFactor" }],
		client: [{ module: "better-auth/client/plugins", name: "twoFactorClient" }],
		requires: "email-password",
		fields: {
			user: [{ name: "twoFactorEnabled", type: "boolean", default: false }],
		},
		tables: [twoFactorTable],
	},
	organization: {
		server: (config) => [
			{
				module: "better-auth/plugins",
				name: "organization",
				call: organizationServerCall(config),
			},
		],
		client: [
			{ module: "better-auth/client/plugins", name: "organizationClient" },
		],
		fields: { session: [{ name: "activeOrganizationId", type: "string" }] },
		tables: organizationTables,
		emitsNamelessTypes: true,
	},
	"email-otp": {
		server: [
			{
				module: "better-auth/plugins",
				name: "emailOTP",
				call: [
					"emailOTP({",
					'      storeOTP: "hashed",',
					"      async sendVerificationOTP({ email, otp, type }) {",
					"        await sendEmail({",
					"          to: email,",
					'          template: "verificationCode",',
					"          props: { code: otp, type },",
					"        });",
					"      },",
					"    })",
				].join("\n"),
			},
		],
		client: [{ module: "better-auth/client/plugins", name: "emailOTPClient" }],
	},
	"magic-link": {
		server: [
			{
				module: "better-auth/plugins",
				name: "magicLink",
				call: [
					"magicLink({",
					'      storeToken: "hashed",',
					"      async sendMagicLink({ email, url }) {",
					"        await sendEmail({",
					"          to: email,",
					'          template: "magicLink",',
					"          props: { url },",
					"        });",
					"      },",
					"    })",
				].join("\n"),
			},
		],
		client: [{ module: "better-auth/client/plugins", name: "magicLinkClient" }],
	},
	passkey: {
		server: [{ module: "./passkey", name: "passkeyPlugin" }],
		client: [{ module: "@better-auth/passkey/client", name: "passkeyClient" }],
		expo: [],
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

	const methods = resolveAuthMethods(config);
	const extensions: ReadonlyArray<
		Extract<AuthMethod, "passkey" | "email-otp" | "magic-link">
	> = ["passkey", "email-otp", "magic-link"];

	return [
		...extensions.filter((extension) => methods.includes(extension)),
		...plugins,
	];
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

export function authSendsEmail(config: ForgeConfig): boolean {
	return (
		authUsesEmail(config) ||
		(config.emailProvider !== undefined &&
			resolveAuthPlugins(config).includes("organization"))
	);
}

export function authRefusesInvitations(config: ForgeConfig): boolean {
	return (
		config.emailProvider === undefined &&
		resolveAuthPlugins(config).includes("organization")
	);
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

export function twoFactorSkippingMethods(
	config: ForgeConfig,
): ReadonlyArray<AuthMethod> {
	return selectedAuthPlugins(config).includes("two-factor")
		? authEmailMethods(config)
		: [];
}

export function authPluginRequirementMessage(
	plugins: ReadonlyArray<AuthPlugin>,
) {
	const labels = listAnd.format(
		plugins.map((plugin) => authPlugins.label(plugin)),
	);

	const methods = new Set(
		plugins.flatMap((plugin) => {
			const required = authPluginRequirement(plugin);
			return required === undefined ? [] : [authMethods.label(required)];
		}),
	);

	return `${labels} ${plugins.length === 1 ? "needs" : "need"} ${methods.size === 1 ? "this sign-in method" : "these sign-in methods"}: ${listAnd.format(methods)}.`;
}

export function twoFactorSkippedMessage(methods: ReadonlyArray<AuthMethod>) {
	const labels = listOr.format(
		methods.map((method) => authMethods.label(method)),
	);

	return methods.length === 1
		? `Two-factor doesn't work with ${labels}, because that sign-in skips the second factor.`
		: `Two-factor doesn't work with ${labels}, because those sign-ins skip the second factor.`;
}

export function resolveAuthPlugins(
	config: ForgeConfig,
): ReadonlyArray<AuthPlugin> {
	const plugins = selectedAuthPlugins(config);
	const missing = unmetAuthPluginRequirements(config);
	if (missing.length > 0)
		throw new Refusal({ message: authPluginRequirementMessage(missing) });

	const skipping = twoFactorSkippingMethods(config);
	if (skipping.length > 0)
		throw new Refusal({ message: twoFactorSkippedMessage(skipping) });

	return plugins;
}

export function authPluginFields(
	config: ForgeConfig,
	model: AuthModel,
): ReadonlyArray<AuthFieldGroup> {
	return resolveAuthPlugins(config).flatMap((plugin) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[plugin];
		const group = definition.fields?.[model];
		return group === undefined ? [] : [group];
	});
}

export function authPluginBindings(
	config: ForgeConfig,
	side: AuthPluginSide,
): ReadonlyArray<AuthPluginImport> {
	return activeAuthExtensions(config).flatMap((extension) => {
		const definition: AuthPluginDefinition = authPluginDefinitions[extension];
		if (side === "server")
			return typeof definition.server === "function"
				? definition.server(config)
				: definition.server;

		return side === "expo"
			? (definition.expo ?? definition.client)
			: definition.client;
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
