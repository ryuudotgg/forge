import { describe, expect, it } from "vitest";
import { authUsesEmail } from "../src/auth/methods";
import {
	authPluginBindings,
	authPluginRequirement,
	authPluginTables,
	resolveAuthPlugins,
} from "../src/auth/plugins";
import type { AuthPlugin, ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	authMethods: ["email-password"],
	backend: "hono",
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
	{ name: "Prisma SQLite", config: { orm: "prisma", database: "sqlite" } },
	{
		name: "Prisma PlanetScale",
		config: {
			orm: "prisma",
			database: "mysql",
			databaseProvider: "planetscale",
		},
	},
];

const selections: ReadonlyArray<ReadonlyArray<AuthPlugin>> = [
	["two-factor"],
	["organization"],
	["two-factor", "organization"],
];

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("two-factor and organization", () => {
	it("requires passwords only for two-factor", () => {
		expect(authPluginRequirement("two-factor")).toBe("email-password");
		expect(authPluginRequirement("organization")).toBeUndefined();
		expect(() =>
			resolveAuthPlugins({
				...baseConfig,
				authMethods: ["google"],
				authPlugins: ["two-factor"],
			}),
		).toThrow("Auth Plugin Requirement: two-factor");

		expect(
			resolveAuthPlugins({
				...baseConfig,
				authMethods: ["google"],
				authPlugins: ["organization"],
			}),
		).toEqual(["organization"]);
	});

	describe.each(variants)("$name", (variant) => {
		it.each(selections)(
			"renders selection %j across server, web and Expo",
			async (...plugins) => {
				const config: ForgeConfig = {
					...baseConfig,
					...variant.config,
					authPlugins: plugins,
					mobile: "expo",
					platforms: ["web", "mobile"],
				};

				const plan = await plannedProject(config);
				const server = writeContent(plan, "packages/auth/src/index.ts");
				const client = writeContent(plan, "packages/auth/src/client.ts");
				const expo = writeContent(plan, "apps/mobile/src/lib/auth-client.ts");

				const twoFactor = plugins.includes("two-factor");
				const organization = plugins.includes("organization");
				for (const content of [client, expo]) {
					expect(content.includes("twoFactorClient()")).toBe(twoFactor);
					expect(content.includes("organizationClient()")).toBe(organization);
				}

				expect(server.includes("twoFactor()")).toBe(twoFactor);
				expect(server.includes("organization({")).toBe(organization);
				expect(server).toContain("expo()");

				expect(client).toContain('fetchOptions: { credentials: "include" }');
				expect(client).toContain("baseURL: process.env.NEXT_PUBLIC_SERVER_URL");
				expect(client).not.toContain("ReturnType<typeof createAuthClient>");
				expect(server).not.toContain("teams:");

				if (config.orm === "drizzle") {
					const schema = writeContent(plan, "packages/db/src/schema/auth.ts");
					const users = writeContent(
						plan,
						"packages/db/src/schema/users/users.ts",
					);

					const relations = writeContent(
						plan,
						"packages/db/src/schema/relations.ts",
					);

					const foreignKeys = config.databaseProvider !== "planetscale";
					const referenceIndexes = config.database !== "mysql" || !foreignKeys;
					const boolean =
						config.database === "sqlite"
							? 'integer({ mode: "boolean" })'
							: "boolean()";

					const integer = config.database === "mysql" ? "int()" : "integer()";
					const date =
						config.database === "sqlite"
							? 'integer({ mode: "timestamp_ms" })'
							: config.database === "mysql"
								? "timestamp({ fsp: 3 })"
								: "timestamp({ withTimezone: true })";

					expect(
						users.includes(`twoFactorEnabled: ${boolean}.default(false)`),
					).toBe(twoFactor);

					expect(schema.includes("export const two_factors")).toBe(twoFactor);
					expect(schema.includes("export const organizations")).toBe(
						organization,
					);

					if (twoFactor) {
						expect(schema).toContain(`verified: ${boolean}.default(true),`);
						expect(schema).toContain(
							`failedVerificationCount: ${integer}.default(0),`,
						);

						expect(schema).toContain(`lockedUntil: ${date},`);
						expect(schema).toContain("backupCodes: text().notNull()");
						expect(schema).toContain(
							'index("two_factors_secret_idx").on(table.secret)',
						);

						expect(schema.includes('index("two_factors_user_id_idx")')).toBe(
							referenceIndexes,
						);

						expect(relations).toContain("twoFactors: r.many.two_factors({");
						expect(server).toContain("twoFactor: two_factors,");
					}

					if (organization) {
						expect(schema).toContain(
							config.database === "mysql"
								? "slug: varchar({ length: 255 }).notNull().unique()"
								: "slug: text().notNull().unique()",
						);

						const defaultText =
							config.database === "mysql"
								? "varchar({ length: 255 })"
								: "text()";

						expect(schema).toContain(
							`role: ${defaultText}.notNull().default("member")`,
						);

						expect(schema).toContain(
							`status: ${defaultText}.notNull().default("pending")`,
						);

						expect(schema).toContain(
							`createdAt: ${date}.notNull()${config.database === "sqlite" ? ".default(unixepochMs)" : ".defaultNow()"}`,
						);

						expect(schema).toContain("activeOrganizationId: text(),");
						expect(schema).toContain("role: text(),");
						expect(schema).toContain(`expiresAt: ${date}.notNull()`);
						expect(schema).toContain('index("invitations_email_idx")');

						for (const index of [
							"members_organization_id",
							"members_user_id",
							"invitations_organization_id",
							"invitations_inviter_id",
						])
							expect(schema.includes(`index("${index}_idx")`)).toBe(
								referenceIndexes,
							);

						for (const model of ["organization", "member", "invitation"])
							expect(server).toContain(`${model}: ${model}s,`);

						expect(relations).toContain(
							"members: r.many.members({\n      from: r.organizations.id,",
						);

						expect(relations).toContain(
							"invitations: r.many.invitations({\n      from: r.organizations.id,",
						);

						expect(relations).toContain("inviter: r.one.users({");
						expect(schema.includes(".references(() => organizations.id")).toBe(
							foreignKeys,
						);
					}

					expect(schema.includes(".references(() => users.id")).toBe(
						foreignKeys,
					);
				} else {
					const schema = writeContent(plan, "packages/db/prisma/schema.prisma");

					expect(schema.includes("model TwoFactor {")).toBe(twoFactor);
					expect(schema.includes("model Organization {")).toBe(organization);
					expect(schema.includes("twoFactorEnabled")).toBe(twoFactor);

					if (twoFactor) {
						expect(schema).toContain("twoFactors TwoFactor[]");
						expect(schema).toContain("verified Boolean? @default(true)");
						expect(schema).toContain(
							'failedVerificationCount Int? @default(0) @map("failed_verification_count")',
						);

						expect(schema).toContain(
							'lockedUntil DateTime? @map("locked_until")',
						);

						expect(schema).toContain("@@index([secret");
						expect(schema).toContain(
							"user User @relation(fields: [userId], references: [id], onDelete: Cascade)",
						);

						expect(schema).not.toContain("userId String @unique");
					}

					if (organization) {
						expect(schema).toContain(
							`slug String @unique${config.database === "mysql" ? " @db.VarChar(255)" : ""}`,
						);

						expect(schema).not.toContain("slug String @unique @db.Text");
						expect(schema).toContain("members Member[]");
						expect(schema).toContain("invitations Invitation[]");
						expect(schema).toContain('role String @default("member")');
						expect(schema).toContain('status String @default("pending")');
						expect(schema).toContain(
							'createdAt DateTime @default(now()) @map("created_at")',
						);

						expect(schema).toContain(
							'activeOrganizationId String? @map("active_organization_id")',
						);

						expect(schema).toContain("@@index([organizationId])");
						expect(schema).toContain("@@index([inviterId])");
						expect(schema).toContain("@@index([email");
						expect(schema).toContain(
							"organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)",
						);

						expect(schema).toContain(
							"inviter User @relation(fields: [inviterId], references: [id], onDelete: Cascade)",
						);
					}

					expect(schema).toContain("@@index([userId])");
				}

				for (const { content } of plan.writes)
					expect(content).not.toMatch(/__[A-Z_]+__/);
			},
		);

		it("keeps omitted and empty selections identical", async () => {
			const config = { ...baseConfig, ...variant.config };
			const omitted = await plannedProject(config);
			const empty = await plannedProject({ ...config, authPlugins: [] });

			const contents = (plan: Awaited<ReturnType<typeof plannedProject>>) =>
				plan.writes
					.filter(({ path }) => !path.endsWith("forge.json") && path !== ".env")
					.map(({ path, content }) => ({ path, content }));

			expect(contents(empty)).toEqual(contents(omitted));
			expect(authPluginTables(config)).toEqual([]);
		});

		it("combines passkey and both plugins without losing tables", async () => {
			const plan = await plannedProject({
				...baseConfig,
				...variant.config,
				authMethods: ["email-password", "passkey"],
				authPlugins: ["two-factor", "organization"],
			});

			const server = writeContent(plan, "packages/auth/src/index.ts");
			const client = writeContent(plan, "packages/auth/src/client.ts");
			const schema = writeContent(
				plan,
				variant.config.orm === "drizzle"
					? "packages/db/src/schema/auth.ts"
					: "packages/db/prisma/schema.prisma",
			);

			expect(server).toMatch(
				/passkeyPlugin\(\),\s+twoFactor\(\),\s+organization\(\{/,
			);

			for (const plugin of [
				"passkeyClient()",
				"twoFactorClient()",
				"organizationClient()",
			])
				expect(client).toContain(plugin);

			expect(schema).toContain(
				variant.config.orm === "drizzle"
					? "export const passkeys"
					: "model Passkey",
			);

			expect(schema).toContain(
				variant.config.orm === "drizzle"
					? "export const two_factors"
					: "model TwoFactor",
			);

			expect(schema).toContain(
				variant.config.orm === "drizzle"
					? "export const organizations"
					: "model Organization",
			);
		});
	});

	it.each([undefined, "resend", "postmark", "smtp"] satisfies ReadonlyArray<
		ForgeConfig["emailProvider"]
	>)("delivers invitations with %s", async (emailProvider) => {
		const config: ForgeConfig = {
			...baseConfig,
			orm: "drizzle",
			database: "sqlite",
			authPlugins: ["organization"],
			emailProvider,
		};

		const plan = await plannedProject(config);
		const server = writeContent(plan, "packages/auth/src/index.ts");
		const manifest = writeContent(plan, "packages/auth/package.json");

		expect(authUsesEmail(config)).toBe(false);
		expect(server).toContain(
			"async sendInvitationEmail({ id, email, organization })",
		);

		expect(server.includes('import { sendEmail } from "@acme/email";')).toBe(
			emailProvider !== undefined,
		);

		expect(server.includes("await sendEmail({")).toBe(
			emailProvider !== undefined,
		);

		expect(server.includes(`console.log(\`Invitation \${id}`)).toBe(
			emailProvider === undefined,
		);

		expect(manifest.includes('"@acme/email": "workspace:*"')).toBe(
			emailProvider !== undefined,
		);
	});

	it("preserves primary and secondary origins with cookie clients", async () => {
		const config: ForgeConfig = {
			...baseConfig,
			backend: "self",
			orm: "drizzle",
			database: "sqlite",
			webApps: [{ name: "admin", framework: "react-router" }],
			authPlugins: ["two-factor", "organization"],
		};

		const plan = await plannedProject(config);
		const client = writeContent(plan, "packages/auth/src/client.ts");
		const server = writeContent(plan, "packages/auth/src/index.ts");

		expect(client).toContain("twoFactorClient()");
		expect(client).toContain("organizationClient()");
		expect(server).toContain("nextCookies()");
		expect(server).toContain("baseURL: normalizeOrigin(env.APP_ORIGIN)");
		expect(writeContent(plan, "apps/admin/package.json")).not.toContain(
			'"@acme/db"',
		);

		expect(authPluginBindings(config, "expo").map(({ name }) => name)).toEqual([
			"twoFactorClient",
			"organizationClient",
		]);
	});
});
