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
	authPluginFields,
	authPluginImports,
} from "../src/auth/plugins";
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
			.map(({ line }) => `  ${line}\n`)
			.join("");
		const grouped = config.database !== "postgresql";
		expect(users).toContain(
			`${grouped ? "\n\n" : "\n"}${columns}${grouped ? "\n" : ""}  createdAt:`,
		);
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
			return `  ${name.padEnd(nameWidth)} ${aligned}\n`;
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
		expect(authPlugins.ids).toEqual(["username", "admin"]);
		expect(authPlugins.label("username")).toBe("Username");
		expect(authPlugins.label("admin")).toBe("Admin");
		expect(authPluginRequirement("username")).toBe("email-password");
		expect(authPluginRequirement("admin")).toBeUndefined();
		expect(
			unmetAuthPluginRequirements({
				...baseConfig,
				authMethods: ["google"],
				authPlugins: ["admin", "username"],
			}),
		).toEqual(["username"]);
		expect(unmetAuthPluginRequirements(baseConfig)).toEqual([]);
	});

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
			"Auth Plugin Requirement: username",
		);
		await expect(plannedProject(config)).rejects.toThrow(
			"Auth Plugin Requirement: username",
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
		).toThrow("Auth Plugin Requirement: username");
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
