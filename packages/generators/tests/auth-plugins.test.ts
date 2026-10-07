import { Refusal } from "@ryuugg/core";
import { describe, expect, it } from "vitest";
import {
	type AuthPlugin,
	authPluginRequirement,
	authPlugins,
	configWithoutInstall,
	type ForgeConfig,
	resolveAuthPlugins,
	unmetAuthPluginRequirements,
} from "../src";
import {
	authPluginBindings,
	authPluginEnvEntries,
	authPluginFields,
	authPluginImports,
	authPluginPackages,
} from "../src/auth/plugins";
import { versions } from "../src/versions";
import { plannedProject } from "./planner-harness";

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password"],
	backend: "hono",
	catalogs: "scoped",
	name: "Acme",
	packageManager: "pnpm",
	platforms: ["web"],
	runtime: "Node.js",
	slug: "acme",
	web: "nextjs",
};

const selections: ReadonlyArray<{
	name: string;
	config: ForgeConfig;
	expected: ReadonlyArray<AuthPlugin>;
}> = [
	{ name: "unset", config: {}, expected: [] },
	{ name: "empty", config: { authPlugins: [] }, expected: [] },
	{
		name: "username",
		config: { authPlugins: ["username"] },
		expected: ["username"],
	},
	{ name: "admin", config: { authPlugins: ["admin"] }, expected: ["admin"] },
	{
		name: "both",
		config: { authPlugins: ["username", "admin"] },
		expected: ["username", "admin"],
	},
	{
		name: "reversed",
		config: { authPlugins: ["admin", "username"] },
		expected: ["username", "admin"],
	},
];

const schemaVariants: ReadonlyArray<{ name: string; config: ForgeConfig }> = [
	{
		name: "Drizzle Postgres",
		config: { orm: "drizzle", database: "postgresql" },
	},
	{ name: "Drizzle MySQL", config: { orm: "drizzle", database: "mysql" } },
	{
		name: "Drizzle PlanetScale MySQL",
		config: {
			orm: "drizzle",
			database: "mysql",
			databaseProvider: "planetscale",
		},
	},
	{ name: "Drizzle SQLite", config: { orm: "drizzle", database: "sqlite" } },
	{
		name: "Prisma Postgres",
		config: { orm: "prisma", database: "postgresql" },
	},
	{ name: "Prisma MySQL", config: { orm: "prisma", database: "mysql" } },
	{ name: "Prisma SQLite", config: { orm: "prisma", database: "sqlite" } },
];

const hosts: ReadonlyArray<{
	name: string;
	config: ForgeConfig;
	cookie?: string;
	cookieModule?: string;
}> = [
	{
		name: "Next.js",
		config: { backend: "self", web: "nextjs" },
		cookie: "nextCookies",
		cookieModule: "better-auth/next-js",
	},
	{
		name: "TanStack Start",
		config: { backend: "self", web: "tanstack-start" },
		cookie: "tanstackStartCookies",
		cookieModule: "better-auth/tanstack-start",
	},
	{
		name: "React Router",
		config: { backend: "self", web: "react-router" },
	},
	{ name: "Hono", config: { backend: "hono" } },
	{ name: "Fastify", config: { backend: "fastify" } },
	{ name: "Express", config: { backend: "express" } },
];

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

function expectPluginClients(
	client: string,
	expo: string,
	plugins: ReadonlyArray<AuthPlugin>,
) {
	const calls = plugins.map((plugin) => `${plugin}Client()`);
	const imports = plugins.map((plugin) => `${plugin}Client`).sort();
	for (const content of [client, expo]) {
		for (const plugin of authPlugins.ids)
			expect(content.includes(`${plugin}Client()`)).toBe(
				plugins.includes(plugin),
			);

		if (imports.length === 0)
			expect(content).not.toContain("better-auth/client/plugins");
		else
			expect(content).toContain(
				`import { ${imports.join(", ")} } from "better-auth/client/plugins";`,
			);

		expect(content).not.toMatch(/__[A-Z_]+__/);
	}

	if (plugins.length === 0)
		expect(client).toContain("authClient: ReturnType<typeof createAuthClient>");
	else {
		expect(client).toContain("export const authClient = createAuthClient({");
		expect(client).not.toContain("ReturnType<typeof createAuthClient>");
		expect(client).toContain(`  plugins: [${calls.join(", ")}],\n});`);
		expect(expo).toContain(
			`    }),\n${calls.map((call) => `    ${call},\n`).join("")}  ],`,
		);
	}
}

function expectDrizzleFields(
	users: string,
	sessions: string,
	config: ForgeConfig,
	plugins: ReadonlyArray<AuthPlugin>,
) {
	const username = plugins.includes("username");
	const admin = plugins.includes("admin");
	const uniqueText =
		config.database === "mysql" ? "varchar({ length: 255 })" : "text()";

	const boolean =
		config.database === "sqlite" ? 'integer({ mode: "boolean" })' : "boolean()";

	const timestamp =
		config.database === "postgresql"
			? "timestamp({ withTimezone: true })"
			: config.database === "mysql"
				? "timestamp({ fsp: 3 })"
				: 'integer({ mode: "timestamp_ms" })';

	const fields = [
		{ line: `username: ${uniqueText}.unique(),`, present: username },
		{ line: "displayUsername: text(),", present: username },
		{ line: "role: text(),", present: admin },
		{ line: `banned: ${boolean}.default(false),`, present: admin },
		{ line: "banReason: text(),", present: admin },
		{ line: `banExpires: ${timestamp},`, present: admin },
	];

	for (const { line, present } of fields)
		expect(users.includes(line)).toBe(present);

	expect(sessions.includes("impersonatedBy: text(),")).toBe(admin);

	if (plugins.length > 0) {
		const columns = fields
			.filter(({ present }) => present)
			.map(
				({ line }) =>
					`${username && line === "role: text()," ? "\n" : ""}  ${line}\n`,
			)
			.join("");

		expect(users).toContain(`\n\n${columns}\n  createdAt:`);
	}

	if (admin) {
		const indent =
			config.database === "mysql" && config.databaseProvider !== "planetscale"
				? "  "
				: "    ";

		expect(sessions).toContain(
			`${indent}userAgent: text(),\n\n${indent}impersonatedBy: text(),\n\n${indent}createdAt:`,
		);
	}
}

function expectPrismaFields(
	schema: string,
	config: ForgeConfig,
	plugins: ReadonlyArray<AuthPlugin>,
) {
	const text = config.database === "mysql" ? " @db.Text" : "";
	const timestamp = config.database === "postgresql" ? " @db.Timestamptz" : "";
	const fields = [
		{
			name: "username",
			definition: "String? @unique",
			present: plugins.includes("username"),
		},
		{
			name: "displayUsername",
			definition: `String? @map("display_username")${text}`,
			present: plugins.includes("username"),
		},
		{
			name: "role",
			definition: `String?${text}`,
			present: plugins.includes("admin"),
		},
		{
			name: "banned",
			definition: "Boolean? @default(false)",
			present: plugins.includes("admin"),
		},
		{
			name: "banReason",
			definition: `String? @map("ban_reason")${text}`,
			present: plugins.includes("admin"),
		},
		{
			name: "banExpires",
			definition: `DateTime? @map("ban_expires")${timestamp}`,
			present: plugins.includes("admin"),
		},
		{
			name: "impersonatedBy",
			definition: `String? @map("impersonated_by")${text}`,
			present: plugins.includes("admin"),
		},
	];

	for (const field of fields) {
		const line = schema
			.split("\n")
			.find((candidate) => candidate.trimStart().startsWith(`${field.name} `));

		expect(line !== undefined).toBe(field.present);

		if (line !== undefined)
			expect(line.trim().replace(/\s+/g, " ")).toBe(
				`${field.name} ${field.definition}`,
			);
	}

	if (plugins.length > 0) {
		const userFields = fields.filter(
			({ name, present }) => name !== "impersonatedBy" && present,
		);

		const nameWidth = Math.max(...userFields.map(({ name }) => name.length));
		const typeWidth = plugins.includes("admin")
			? "DateTime?".length
			: "String?".length;

		const lines = userFields.map(({ name, definition }) => {
			const space = definition.indexOf(" ");
			const aligned =
				space === -1
					? definition
					: `${definition.slice(0, space).padEnd(typeWidth)}${definition.slice(space)}`;

			const groupStart = plugins.includes("username") && name === "role";
			return `${groupStart ? "\n" : ""}  ${name.padEnd(nameWidth)} ${aligned}\n`;
		});

		expect(schema).toContain(`\n\n${lines.join("")}\n  createdAt`);
	}

	if (plugins.includes("admin"))
		expect(schema).toContain(
			`\n\n  impersonatedBy String? @map("impersonated_by")${text}\n\n  createdAt`,
		);
}

describe("auth plugins", () => {
	it("exports choices, requirements and the unmet selections for the CLI", () => {
		expect(authPlugins.ids).toEqual([
			"two-factor",
			"username",
			"admin",
			"organization",
			"polar",
		]);

		expect(authPlugins.label("username")).toBe("Username");
		expect(authPlugins.label("admin")).toBe("Admin");
		expect(authPluginRequirement("username")).toBe("email-password");
		expect(authPluginRequirement("admin")).toBeUndefined();

		expect(authPlugins.label("polar")).toBe("Polar");
		expect(authPluginRequirement("polar")).toBeUndefined();
		expect(
			unmetAuthPluginRequirements({
				...baseConfig,
				authMethods: ["google"],
				authPlugins: ["admin", "username"],
			}),
		).toEqual(["username"]);

		expect(unmetAuthPluginRequirements(baseConfig)).toEqual([]);
	});

	it("declares Polar bindings, packages and env without schema fields", () => {
		const config: ForgeConfig = {
			...baseConfig,
			authMethods: ["google"],
			authPlugins: ["polar"],
		};

		expect(resolveAuthPlugins(config)).toEqual(["polar"]);
		expect(authPluginFields(config, "user")).toEqual([]);
		expect(authPluginFields(config, "session")).toEqual([]);
		expect(authPluginBindings(config, "server")).toEqual([
			{ module: "./polar", name: "polarPlugin" },
			{ module: "./polar", name: "polarAvailability" },
		]);

		expect(authPluginBindings(config, "client")).toEqual([
			{ module: "@polar-sh/better-auth/client", name: "polarClient" },
		]);

		for (const side of ["auth", "expo"] satisfies ReadonlyArray<
			"auth" | "expo"
		>) {
			expect(authPluginPackages(config, side)).toMatchObject([
				{
					name: versions.polarBetterAuth.name,
					version: versions.polarBetterAuth.version,
				},
				{ name: versions.polarSdk.name, version: versions.polarSdk.version },
			]);

			expect(authPluginPackages(baseConfig, side)).toEqual([]);
		}

		expect(authPluginEnvEntries(config).map(({ name }) => name)).toEqual([
			"POLAR_ACCESS_TOKEN",
			"POLAR_WEBHOOK_SECRET",
			"POLAR_SERVER",
		]);

		expect(authPluginEnvEntries(baseConfig)).toEqual([]);
		expect(versions.polarBetterAuth.group).toBe(versions.polarSdk.group);
	});

	describe("Polar", () => {
		it.each(schemaVariants)(
			"renders $name and both clients",
			async (variant) => {
				const config: ForgeConfig = {
					...baseConfig,
					...variant.config,
					authPlugins: ["polar"],
					mobile: "expo",
					platforms: ["web", "mobile"],
				};

				const plan = await plannedProject(config);
				const polar = writeContent(plan, "packages/auth/src/polar.ts");
				const server = writeContent(plan, "packages/auth/src/index.ts");
				const env = writeContent(plan, "packages/auth/env.ts");

				expect(polar).toContain(
					'import { createPolarCore } from "@polar-sh/sdk/2026-10";',
				);

				expect(polar).toContain('import { env } from "../env";');
				expect(polar).toContain("export function polarPlugin()");
				expect(polar).toContain("export function polarAvailability()");
				expect(polar).toContain("createCustomerOnSignUp: false");

				expect(polar).toContain("checkout({ authenticatedUsersOnly: true })");
				expect(polar).toContain('accessToken: env.POLAR_ACCESS_TOKEN ?? ""');
				expect(polar).toContain('environment: env.POLAR_SERVER ?? "sandbox"');
				expect(polar).toContain(
					'webhooks({ secret: env.POLAR_WEBHOOK_SECRET ?? "" })',
				);

				expect(polar).toContain('new APIError("SERVICE_UNAVAILABLE"');
				expect(polar).toContain("path: string | undefined");

				for (const path of [
					"portal",
					"state",
					"benefits/list",
					"subscriptions/list",
					"orders/list",
				])
					expect(polar).toContain(`"/customer/${path}"`);

				expect(polar).not.toMatch(
					/\b(?:products|prices|productId|priceId|product_id|price_id)\b/,
				);

				expect(server).toContain(
					'import { polarAvailability, polarPlugin } from "./polar";\n\nconst',
				);

				expect(server).toContain("polarPlugin(), polarAvailability()");

				for (const path of [
					"packages/auth/src/client.ts",
					"apps/mobile/src/lib/auth-client.ts",
				]) {
					const client = writeContent(plan, path);

					expect(client).toContain(
						'import { polarClient } from "@polar-sh/better-auth/client";',
					);

					expect(client).toContain("polarClient()");
				}

				for (const path of [
					"packages/auth/package.json",
					"apps/mobile/package.json",
				]) {
					const manifest: unknown = JSON.parse(writeContent(plan, path));

					expect(manifest).toMatchObject({
						dependencies: {
							[versions.polarBetterAuth.name]: "catalog:",
							[versions.polarSdk.name]: "catalog:",
						},
					});
				}

				const catalog = writeContent(plan, "pnpm-workspace.yaml");
				for (const entry of [versions.polarBetterAuth, versions.polarSdk])
					expect(catalog).toContain(`  "${entry.name}": ${entry.version}`);

				for (const path of [".env", ".env.example"]) {
					const content = writeContent(plan, path);

					expect(content).toContain(
						'POLAR_ACCESS_TOKEN=""\nPOLAR_WEBHOOK_SECRET=""\nPOLAR_SERVER="sandbox"',
					);
				}

				for (const name of ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET"])
					expect(env).toContain(
						`${name}: z.string().trim().min(1).optional(),`,
					);

				expect(env).toContain(
					'POLAR_SERVER: z.enum(["sandbox", "production"]).optional(),',
				);

				for (const name of [
					"POLAR_ACCESS_TOKEN",
					"POLAR_WEBHOOK_SECRET",
					"POLAR_SERVER",
				])
					expect(env).toContain(`${name}: process.env.${name},`);

				const declarationsOff = {
					compilerOptions: { declaration: false, declarationMap: false },
				};

				expect(
					JSON.parse(writeContent(plan, "packages/auth/tsconfig.json")),
				).toMatchObject(declarationsOff);

				const baseline = await plannedProject({ ...config, authPlugins: [] });
				expect(
					JSON.parse(writeContent(baseline, "packages/auth/tsconfig.json")),
				).not.toMatchObject(declarationsOff);

				const schemaWrites = (project: typeof plan) =>
					project.writes
						.filter(
							({ path }) =>
								path.startsWith("packages/db/src/schema/") ||
								path.endsWith("schema.prisma"),
						)
						.map(({ path, content }) => ({ path, content }));

				expect(schemaWrites(plan)).toEqual(schemaWrites(baseline));
				expect(
					baseline.writes.some(({ path }) => path.endsWith("/polar.ts")),
				).toBe(false);

				for (const write of baseline.writes) {
					expect(write.content).not.toContain("POLAR");

					if (write.path !== "pnpm-workspace.yaml")
						expect(write.content).not.toContain("@polar-sh/");
				}
			},
		);
	});

	it("wraps the Next.js plugins array when Polar exceeds 80 columns", async () => {
		const plan = await plannedProject({
			...baseConfig,
			backend: "self",
			orm: "drizzle",
			database: "sqlite",
			authPlugins: ["polar", "admin", "username"],
		});

		const server = writeContent(plan, "packages/auth/src/index.ts");

		expect(server).toContain(
			[
				"  plugins: [",
				"    username(),",
				"    admin(),",
				"    polarPlugin(),",
				"    polarAvailability(),",
				"    nextCookies(),",
				"  ],",
			].join("\n"),
		);

		expect(server).toContain(
			'import { nextCookies } from "better-auth/next-js";\nimport { admin, username } from "better-auth/plugins";\nimport { polarAvailability, polarPlugin } from "./polar";',
		);
	});

	it("wraps the web client plugins array when it exceeds 80 columns", async () => {
		const plan = await plannedProject({
			...baseConfig,
			backend: "self",
			orm: "drizzle",
			database: "mysql",
			authMethods: ["email-password", "google", "passkey"],
			authPlugins: ["two-factor", "username", "admin", "organization"],
		});

		expect(writeContent(plan, "packages/auth/src/client.ts")).toContain(
			[
				"export const authClient = createAuthClient({",
				"  plugins: [",
				"    passkeyClient(),",
				"    twoFactorClient(),",
				"    usernameClient(),",
				"    adminClient(),",
				"    organizationClient(),",
				"  ],",
				"});",
			].join("\n"),
		);
	});

	it.each([
		{
			columns: 80,
			authMethods: ["email-password", "email-otp", "passkey"],
			authPlugins: ["username", "admin"],
			plugins:
				"  plugins: [passkeyClient(), emailOTPClient(), usernameClient(), adminClient()],",
		},
		{
			columns: 81,
			authMethods: ["email-password", "passkey"],
			authPlugins: ["two-factor", "username", "admin"],
			plugins: [
				"  plugins: [",
				"    passkeyClient(),",
				"    twoFactorClient(),",
				"    usernameClient(),",
				"    adminClient(),",
				"  ],",
			].join("\n"),
		},
	] satisfies ReadonlyArray<{
		columns: number;
		authMethods: ForgeConfig["authMethods"];
		authPlugins: ForgeConfig["authPlugins"];
		plugins: string;
	}>)(
		"keeps a $columns column client plugins line inline only up to 80",
		async ({ authMethods, authPlugins, plugins }) => {
			const plan = await plannedProject({
				...baseConfig,
				backend: "self",
				orm: "drizzle",
				database: "sqlite",
				emailProvider: "resend",
				authMethods,
				authPlugins,
			});

			expect(writeContent(plan, "packages/auth/src/client.ts")).toContain(
				`export const authClient = createAuthClient({\n${plugins}\n});`,
			);
		},
	);

	it("canonicalizes and deduplicates without mutating the selection", () => {
		const selected: ReadonlyArray<AuthPlugin> = ["admin", "username", "admin"];
		const config: ForgeConfig = { ...baseConfig, authPlugins: selected };

		expect(resolveAuthPlugins(config)).toEqual(["username", "admin"]);
		expect(config.authPlugins).toBe(selected);
		expect(selected).toEqual(["admin", "username", "admin"]);
		expect(unmetAuthPluginRequirements(config)).toEqual([]);
	});

	it.each(
		[
			null,
			false,
			1,
			"username",
			["unknown"],
			["admin", null],
			new Array<unknown>(1),
		].map((value) => ({ value })),
	)("rejects an invalid list $value", ({ value }) => {
		const config: ForgeConfig = Object.assign({}, baseConfig, {
			authPlugins: value,
		});

		expect(() => resolveAuthPlugins(config)).toThrow(
			`Invalid Auth Plugins: ${JSON.stringify(value)}`,
		);
	});

	it("ignores plugin lists before validation when Better Auth is absent", () => {
		const config: ForgeConfig = Object.assign({}, baseConfig, {
			authentication: undefined,
			authPlugins: ["unknown"],
		});

		expect(resolveAuthPlugins(config)).toEqual([]);
		expect(unmetAuthPluginRequirements(config)).toEqual([]);
		expect(authPluginFields(config, "user")).toEqual([]);
		expect(authPluginFields(config, "session")).toEqual([]);
		expect(authPluginBindings(config, "server")).toEqual([]);
	});

	it("enforces username's method and permits admin without it", async () => {
		const config: ForgeConfig = {
			...baseConfig,
			orm: "drizzle",
			database: "postgresql",
			authMethods: ["google"],
			authPlugins: ["username"],
		};

		expect(() => resolveAuthPlugins(config)).toThrow(
			new Refusal({
				message: "Username needs this sign-in method: Email and password.",
			}),
		);
		expect(() => resolveAuthPlugins(config)).toThrow(Refusal);

		await expect(plannedProject(config)).rejects.toThrow(
			"Username needs this sign-in method: Email and password.",
		);

		expect(resolveAuthPlugins({ ...config, authPlugins: ["admin"] })).toEqual([
			"admin",
		]);

		expect(() =>
			resolveAuthPlugins({
				...config,
				backend: "self",
				authMethods: undefined,
			}),
		).toThrow(
			new Refusal({
				message: "Username needs this sign-in method: Email and password.",
			}),
		);

		expect(resolveAuthPlugins({ ...config, authMethods: undefined })).toEqual([
			"username",
		]);
	});

	it("drops both dependent fields when Better Auth is removed", () => {
		expect(
			configWithoutInstall(
				{
					authentication: "better-auth",
					authMethods: ["email-password"],
					authPlugins: ["username", "admin"],
					orm: "drizzle",
				},
				"better-auth",
			),
		).toEqual({ orm: "drizzle" });
	});

	it("groups imports by module, sorts names and wraps long imports", () => {
		expect(
			authPluginImports([
				{ module: "z-module", name: "username" },
				{ module: "a-module", name: "expo" },
				{ module: "z-module", name: "admin" },
				{ module: "z-module", name: "admin" },
			]),
		).toBe(
			'import { expo } from "a-module";\nimport { admin, username } from "z-module";\n',
		);

		const module = "a".repeat(55);

		expect(
			authPluginImports([
				{ module, name: "username" },
				{ module, name: "admin" },
			]),
		).toBe(`import {\n  admin,\n  username,\n} from "${module}";\n`);
	});

	describe.each(schemaVariants)("$name", (variant) => {
		it.each(selections)(
			"renders $name with web and Expo clients",
			async (selection) => {
				const config: ForgeConfig = {
					...baseConfig,
					...variant.config,
					...selection.config,
					mobile: "expo",
					platforms: ["web", "mobile"],
				};

				const plan = await plannedProject(config);
				const server = writeContent(plan, "packages/auth/src/index.ts");
				const client = writeContent(plan, "packages/auth/src/client.ts");
				const expo = writeContent(plan, "apps/mobile/src/lib/auth-client.ts");
				const calls = [
					...selection.expected.map((plugin) => `${plugin}()`),
					"expo()",
				];

				expect(resolveAuthPlugins(config)).toEqual(selection.expected);
				expect(server).toContain(`  plugins: [${calls.join(", ")}],`);
				expect(server).not.toMatch(/__[A-Z_]+__/);
				expectPluginClients(client, expo, selection.expected);

				expect(client).toContain("baseURL: process.env.NEXT_PUBLIC_SERVER_URL");
				expect(client).toContain('fetchOptions: { credentials: "include" }');

				if (config.orm === "drizzle") {
					const users = writeContent(
						plan,
						"packages/db/src/schema/users/users.ts",
					);

					const sessions = writeContent(plan, "packages/db/src/schema/auth.ts");

					expectDrizzleFields(users, sessions, config, selection.expected);

					for (const content of [users, sessions]) {
						expect(content).not.toMatch(/__[A-Z_]+__/);
						expect(content).not.toContain("\n\n\n");
					}
				} else {
					const schema = writeContent(plan, "packages/db/prisma/schema.prisma");

					expectPrismaFields(schema, config, selection.expected);
					expect(schema).not.toMatch(/__[A-Z_]+__/);
					expect(schema).not.toContain("\n\n\n");
				}
			},
		);
	});

	describe.each(hosts)("$name host", (host) => {
		it.each(schemaVariants)(
			"renders server plugins on $name",
			async (variant) => {
				for (const selection of selections) {
					const plan = await plannedProject({
						...baseConfig,
						...variant.config,
						...host.config,
						...selection.config,
						mobile: "expo",
						platforms: ["web", "mobile"],
					});

					const server = writeContent(plan, "packages/auth/src/index.ts");
					const client = writeContent(plan, "packages/auth/src/client.ts");
					const expo = writeContent(plan, "apps/mobile/src/lib/auth-client.ts");
					const calls = [
						...selection.expected.map((plugin) => `${plugin}()`),
						"expo()",
						...(host.cookie ? [`${host.cookie}()`] : []),
					];

					expect(server).toContain(`  plugins: [${calls.join(", ")}],`);
					expect(server).not.toMatch(/__[A-Z_]+__/);
					expectPluginClients(client, expo, selection.expected);

					for (const plugin of authPlugins.ids)
						expect(server.includes(`${plugin}()`)).toBe(
							selection.expected.includes(plugin),
						);

					if (selection.expected.length > 0)
						expect(server).toContain(
							`import { ${[...selection.expected].sort().join(", ")} } from "better-auth/plugins";`,
						);
					else expect(server).not.toContain('from "better-auth/plugins"');

					if (host.cookie && host.cookieModule)
						expect(server).toContain(
							`import { ${host.cookie} } from "${host.cookieModule}";`,
						);

					const imports = server
						.split("\n")
						.filter((line) => line.startsWith("import {"));

					const pluginImports = imports.filter((line) =>
						/"(?:@better-auth\/expo|better-auth\/(?:plugins|next-js|tanstack-start))"/.test(
							line,
						),
					);

					expect(pluginImports).toEqual(
						[...pluginImports].sort((left, right) => {
							const leftModule = left.split('"')[1] ?? "";
							const rightModule = right.split('"')[1] ?? "";
							return leftModule.localeCompare(rightModule);
						}),
					);
				}
			},
		);
	});

	it.each(hosts)(
		"keeps no-plugin self and standalone client options on $name",
		async (host) => {
			for (const plugins of [undefined, []]) {
				const plan = await plannedProject({
					...baseConfig,
					...host.config,
					orm: "drizzle",
					database: "postgresql",
					authPlugins: plugins,
				});

				const server = writeContent(plan, "packages/auth/src/index.ts");
				const client = writeContent(plan, "packages/auth/src/client.ts");

				expect(client).toContain(
					"authClient: ReturnType<typeof createAuthClient>",
				);

				expect(client).not.toContain("better-auth/client/plugins");
				expect(server).not.toMatch(/__[A-Z_]+__/);
				expect(client).not.toMatch(/__[A-Z_]+__/);

				if (host.config.backend === "self")
					expect(client).toContain("  createAuthClient();\n");
				else
					expect(client).toContain(
						'    fetchOptions: { credentials: "include" },',
					);
			}
		},
	);
});
