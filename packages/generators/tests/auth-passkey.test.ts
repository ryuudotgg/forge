import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderBetterAuthTemplate } from "../src/auth/better-auth/shared";
import { authPasskeyIssue, authUsesPasskey } from "../src/auth/methods";
import {
	authPluginBindings,
	authPluginFiles,
	authPluginPackages,
	authPluginTables,
	resolveAuthPlugins,
} from "../src/auth/plugins";
import { authColumnName } from "../src/auth/tables";
import type { ForgeConfig } from "../src/config";
import { catalogRef, versions } from "../src/versions";
import { plannedProject } from "./planner-harness";

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password", "passkey"],
	backend: "hono",
	catalogs: "scoped",
	name: "Acme",
	packageManager: "pnpm",
	platforms: ["web"],
	runtime: "Node.js",
	slug: "acme",
	web: "nextjs",
};

const variants: ReadonlyArray<{ name: string; config: ForgeConfig }> = [
	{
		name: "Drizzle Postgres",
		config: { orm: "drizzle", database: "postgresql" },
	},
	{ name: "Drizzle MySQL", config: { orm: "drizzle", database: "mysql" } },
	{
		name: "Drizzle PlanetScale",
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
	{
		name: "Prisma PlanetScale",
		config: {
			orm: "prisma",
			database: "mysql",
			databaseProvider: "planetscale",
		},
	},
	{ name: "Prisma SQLite", config: { orm: "prisma", database: "sqlite" } },
];

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("passkey selection", () => {
	it("checks configured methods without substituting defaults", () => {
		const absentMethods: ReadonlyArray<ForgeConfig["authMethods"]> = [
			undefined,
			[],
			["email-password"],
		];

		for (const authMethods of absentMethods)
			expect(authPasskeyIssue({ ...baseConfig, authMethods })).toBeUndefined();

		const passkeyOnlyMethods: ReadonlyArray<ForgeConfig["authMethods"]> = [
			["passkey"],
			["passkey", "passkey"],
		];

		for (const authMethods of passkeyOnlyMethods) {
			expect(authPasskeyIssue({ ...baseConfig, authMethods })).toBe(
				"Passkeys need another sign-in method to create accounts.",
			);

			expect(
				authPasskeyIssue({ ...baseConfig, authMethods, web: undefined }),
			).toBe("Passkeys need another sign-in method to create accounts.");
		}

		expect(
			authPasskeyIssue({ ...baseConfig, web: undefined, mobile: "expo" }),
		).toBe("Passkeys need a web app.");

		expect(authPasskeyIssue(baseConfig)).toBeUndefined();
	});

	it("uses a method-backed definition without changing public plugins", () => {
		expect(authUsesPasskey(baseConfig)).toBe(true);
		expect(resolveAuthPlugins(baseConfig)).toEqual([]);
		expect(authPluginTables(baseConfig).map(({ model }) => model)).toEqual([
			"passkey",
		]);

		expect(authPluginFiles(baseConfig)).toEqual(["src/passkey.ts"]);
		expect(authPluginBindings(baseConfig, "client")).toEqual([
			{ module: "@better-auth/passkey/client", name: "passkeyClient" },
		]);

		expect(authPluginBindings(baseConfig, "expo")).toEqual([]);
		expect(authPluginPackages(baseConfig, "expo")).toEqual([]);
		expect(authPluginPackages(baseConfig, "auth")).toEqual([
			{
				name: "@better-auth/passkey",
				version: versions.betterAuthPasskey.version,
				catalog: "",
			},
		]);
	});

	it("does not contribute when absent or auth is disabled", () => {
		for (const config of [
			{ ...baseConfig, authMethods: undefined },
			{ ...baseConfig, authentication: undefined },
		]) {
			expect(authUsesPasskey(config)).toBe(false);
			expect(authPluginTables(config)).toEqual([]);
			expect(authPluginFiles(config)).toEqual([]);
			expect(authPluginBindings(config, "client")).toEqual([]);
		}
	});

	it("maps acronym names to the expected physical column", () => {
		expect(authColumnName("credentialID")).toBe("credential_id");
		expect(authColumnName("userId")).toBe("user_id");
	});

	it.each(["scoped", "flat", "npm"])(
		"pins all Better Auth consumers with %s catalogs",
		async (catalogs) => {
			const config: ForgeConfig = {
				...baseConfig,
				orm: "drizzle",
				database: "sqlite",
				mobile: "expo",
				packageManager: catalogs === "npm" ? "npm" : "pnpm",
				catalogs: catalogs === "scoped" ? "scoped" : "flat",
			};

			const plan = await plannedProject(config);
			for (const path of [
				"packages/auth/package.json",
				"apps/server/package.json",
				"apps/mobile/package.json",
			]) {
				const manifest: unknown = JSON.parse(writeContent(plan, path));

				expect(manifest).toMatchObject({
					dependencies: {
						"better-auth":
							catalogs === "npm"
								? catalogRef("betterAuth", config).version
								: "catalog:",
					},
				});
			}

			const expo = writeContent(plan, "apps/mobile/src/lib/auth-client.ts");
			expect(expo).not.toContain("passkey");
			expect(writeContent(plan, "apps/mobile/package.json")).not.toContain(
				"@better-auth/passkey",
			);

			expect(catalogRef("betterAuth", config).version).toBe(
				versions.betterAuthPasskey.version,
			);

			expect(
				catalogRef("betterAuth", { ...config, authMethods: ["email-password"] })
					.version,
			).toBe(versions.betterAuth.version);
		},
	);
});

describe("passkey generation", () => {
	it("cleans up user-owned plugin rows only without foreign keys", async () => {
		const plan = await plannedProject({
			...baseConfig,
			orm: "drizzle",
			database: "mysql",
			databaseProvider: "planetscale",
			authPlugins: ["two-factor", "organization"],
		});

		const server = writeContent(plan, "packages/auth/src/index.ts");

		expect(server).toContain('import { eq } from "@acme/db";');
		expect(server).toContain("databaseHooks: {");
		expect(server).toContain("after: async ({ id }) => {");
		expect(server.match(/await db\.delete\([^;]+;/g)).toEqual([
			"await db.delete(passkeys).where(eq(passkeys.userId, id));",
			"await db.delete(two_factors).where(eq(two_factors.userId, id));",
			"await db.delete(members).where(eq(members.userId, id));",
			"await db.delete(invitations).where(eq(invitations.inviterId, id));",
		]);
	});

	it.each(variants)(
		"omits user cleanup for $name unless needed",
		async ({ config }) => {
			const plan = await plannedProject({
				...baseConfig,
				...config,
				authMethods:
					config.databaseProvider === "planetscale" && config.orm === "drizzle"
						? ["email-password"]
						: baseConfig.authMethods,
				authPlugins:
					config.databaseProvider === "planetscale" && config.orm === "drizzle"
						? []
						: ["two-factor", "organization"],
			});

			const server = writeContent(plan, "packages/auth/src/index.ts");

			expect(server).not.toContain("databaseHooks");
			expect(server).not.toContain('import { eq } from "@acme/db";');
		},
	);

	it.each(["hono", "self"] as const)(
		"accepts secondary web origins with a %s host",
		async (backend) => {
			const plan = await plannedProject({
				...baseConfig,
				backend,
				orm: "drizzle",
				database: "sqlite",
				webApps: [{ name: "admin", framework: "react-router", client: true }],
			});

			const options = writeContent(plan, "packages/auth/src/passkey.ts");

			expect(options).toContain("origin: webOrigins,");

			expect(options).toContain(
				"rpID: env.PASSKEY_RP_ID ?? relyingParty.hostname",
			);

			const authEnv = writeContent(plan, "packages/auth/env.ts");

			expect(authEnv).toContain(
				"PASSKEY_RP_ID: z.string().trim().min(1).optional()",
			);

			expect(authEnv).toContain("PASSKEY_RP_ID: process.env.PASSKEY_RP_ID");
			expect(writeContent(plan, ".env.example")).toContain('PASSKEY_RP_ID=""');
			expect(writeContent(plan, "packages/auth/README.md")).toContain(
				"use `example.com`",
			);

			expect(writeContent(plan, "packages/auth/src/index.ts")).toContain(
				"trustedOrigins: webOrigins,",
			);

			expect(writeContent(plan, "apps/admin/app/lib/auth-client.ts")).toContain(
				"baseURL: env.VITE_SERVER_URL",
			);
		},
	);

	it.each([undefined, "example.com"])(
		"runs secondary passkey options with RP ID %s",
		(relyingPartyId) => {
			const source = renderBetterAuthTemplate(
				{
					...baseConfig,
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
				},
				"packages/auth/src/passkey.ts",
			)
				.replace(
					'import { type PasskeyOptions, passkey } from "@better-auth/passkey";',
					"",
				)
				.replace('import { env, webOrigins } from "../env";', "")
				.replace("export function passkeyPlugin", "function passkeyPlugin");

			const options: unknown = new Script(
				`${stripTypeScriptTypes(source)}\npasskeyPlugin();`,
			).runInNewContext({
				URL,
				env: {
					WEB_URL: "https://app.example.com",
					PASSKEY_RP_ID: relyingPartyId,
				},
				webOrigins: ["https://app.example.com", "https://admin.example.com"],
				passkey: (value: unknown) => value,
			});

			expect(options).toMatchObject({
				rpID: relyingPartyId ?? "app.example.com",
				origin: ["https://app.example.com", "https://admin.example.com"],
			});
		},
	);

	it.each(variants)(
		"wires server, web and schema for $name",
		async ({ config: variant }) => {
			const config = { ...baseConfig, ...variant };
			const plan = await plannedProject(config);
			const server = writeContent(plan, "packages/auth/src/index.ts");
			const client = writeContent(plan, "packages/auth/src/client.ts");
			const options = writeContent(plan, "packages/auth/src/passkey.ts");

			expect(server).toContain('import { passkeyPlugin } from "./passkey";');
			expect(server).toContain("passkeyPlugin()");
			expect(client).toContain(
				'import { passkeyClient } from "@better-auth/passkey/client";',
			);

			expect(client).toContain("plugins: [passkeyClient()]");
			expect(client).not.toContain("ReturnType<typeof createAuthClient>");
			expect(options).toContain(
				'import { type PasskeyOptions, passkey } from "@better-auth/passkey";',
			);

			expect(options).toContain("new URL(env.WEB_URL)");
			expect(options).toContain('rpName: "Acme"');
			expect(options).toContain("rpID: relyingParty.hostname");
			expect(options).toContain("origin: relyingParty.origin");

			expect(options).toContain("registration: { extensions: {} }");
			expect(options).toContain("authentication: { extensions: {} }");
			expect(options).toContain("satisfies PasskeyOptions");
			expect(options).toContain("return passkey(options)");
			expect(writeContent(plan, "packages/auth/package.json")).toContain(
				'"@better-auth/passkey": "catalog:"',
			);

			expect(writeContent(plan, "pnpm-workspace.yaml")).toContain(
				`"@better-auth/passkey": ${versions.betterAuthPasskey.version}`,
			);

			if (config.orm === "drizzle") {
				const schema = writeContent(plan, "packages/db/src/schema/auth.ts");
				const table = schema.slice(schema.indexOf("export const passkeys"));
				const relations = writeContent(
					plan,
					"packages/db/src/schema/relations.ts",
				);

				expect(server).toContain("passkey: passkeys,");
				expect(schema).toMatch(
					/import\s*\{[^}]*\bindex\b[^}]*\}\s*from "drizzle-orm\/(?:pg|mysql|sqlite)-core";/,
				);

				expect(table).toContain('"passkeys"');
				expect(table).toMatch(
					config.database === "mysql"
						? /index\("passkeys_credential_id_idx"\)\.on\(sql`\$\{table\.credentialID\}\(191\)`\)/
						: /index\("passkeys_credential_id_idx"\)\.on\(table\.credentialID\)/,
				);

				expect(schema.includes('import { sql } from "drizzle-orm";')).toBe(
					config.database !== "postgresql",
				);

				expect(table.includes('index("passkeys_user_id_idx")')).toBe(
					config.database !== "mysql" ||
						config.databaseProvider === "planetscale",
				);

				expect(table.includes(".references(() => users.id")).toBe(
					config.databaseProvider !== "planetscale",
				);

				expect(table).not.toContain(".unique()");
				expect(table).not.toContain(".default");
				expect(relations).toContain("passkeys: r.many.passkeys({");
				expect(relations).toContain("from: r.passkeys.userId,");
				expect(relations).toContain("to: r.users.id,");

				const date =
					config.database === "postgresql"
						? "timestamp({ withTimezone: true })"
						: config.database === "mysql"
							? "timestamp({ fsp: 3 })"
							: 'integer({ mode: "timestamp_ms" })';

				const boolean =
					config.database === "sqlite"
						? 'integer({ mode: "boolean" })'
						: "boolean()";

				const integer = config.database === "mysql" ? "int()" : "integer()";
				expect(table).toContain(`createdAt: ${date},`);
				expect(table).toContain(`backedUp: ${boolean}.notNull(),`);
				expect(table).toContain(`counter: ${integer}.notNull(),`);
				expect(table).toContain(
					'credentialID: text("credential_id").notNull(),',
				);

				for (const name of [
					"name",
					"publicKey",
					"deviceType",
					"transports",
					"aaguid",
				])
					expect(table).toContain(`${name}: text()`);
			} else {
				const schema = writeContent(plan, "packages/db/prisma/schema.prisma");
				const table = schema.slice(schema.indexOf("model Passkey"));

				expect(schema).toContain("passkeys Passkey[]");
				expect(table).toContain('@@map("passkeys")');
				expect(table).toContain("@@index([userId])");
				expect(table).toContain(
					config.database === "mysql"
						? "@@index([credentialID(length: 191)])"
						: "@@index([credentialID])",
				);

				expect(table).toContain(
					`credentialID String @map("credential_id")${config.database === "mysql" ? " @db.Text" : ""}`,
				);

				expect(table).toContain(
					"user User @relation(fields: [userId], references: [id], onDelete: Cascade)",
				);

				expect(table).toContain("counter Int");
				expect(table).toContain('backedUp Boolean @map("backed_up")');
				expect(table).toContain(
					`createdAt DateTime? @map("created_at")${config.database === "postgresql" ? " @db.Timestamptz" : ""}`,
				);

				expect(table).not.toContain("@default");
				expect(table).not.toContain("@unique");

				for (const name of ["name", "transports", "aaguid"])
					expect(table).toContain(
						`${name} String?${config.database === "mysql" ? " @db.Text" : ""}`,
					);
			}

			for (const { content } of plan.writes)
				expect(content).not.toMatch(/__[A-Z_]+__/);
		},
	);

	it("keeps other plugins in Expo and cookies after passkey", async () => {
		const plan = await plannedProject({
			...baseConfig,
			backend: "self",
			orm: "drizzle",
			database: "postgresql",
			mobile: "expo",
			authPlugins: ["username", "admin"],
		});

		const server = writeContent(plan, "packages/auth/src/index.ts");
		const expo = writeContent(plan, "apps/mobile/src/lib/auth-client.ts");

		expect(server).toContain(
			"passkeyPlugin(), username(), admin(), expo(), nextCookies()",
		);

		expect(expo).toContain("usernameClient()");
		expect(expo).toContain("adminClient()");
		expect(expo).not.toContain("passkey");
		expect(writeContent(plan, "packages/auth/src/passkey.ts")).toContain(
			"new URL(env.APP_ORIGIN)",
		);
	});

	it("allows passkey-only web-less enrollment customization", async () => {
		const config: ForgeConfig = {
			...baseConfig,
			authMethods: ["passkey"],
			web: undefined,
			platforms: ["mobile"],
			mobile: "expo",
			orm: "drizzle",
			database: "sqlite",
		};

		const plan = await plannedProject(config);
		const options = writeContent(plan, "packages/auth/src/passkey.ts");

		expect(options).toContain("new URL(env.APP_ORIGIN)");
		expect(options).not.toContain("WEB_URL");
		expect(writeContent(plan, "packages/auth/src/index.ts")).not.toContain(
			"emailAndPassword",
		);
	});

	it("escapes names as source strings", () => {
		const options = renderBetterAuthTemplate(
			{ ...baseConfig, name: 'Acme "Keys"\n' },
			"packages/auth/src/passkey.ts",
		);

		expect(options).toContain('rpName: "Acme \\"Keys\\"\\n"');
	});
});
