import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	readJson,
	withScenarioWorkspace,
} from "../utils/harness";

interface Manifest {
	readonly installs: Array<{ definitionId: string }>;
}

describe("better auth", () => {
	it("wires the drizzle adapter and auth schema for drizzle projects", async () => {
		await withScenarioWorkspace("better-auth-drizzle", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
			});

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const [auth, authSchema, schemaIndex, workspaceYaml, manifest] =
				await Promise.all([
					readText("packages/auth/src/index.ts"),
					readText("packages/db/src/schema/auth.ts"),
					readText("packages/db/src/schema/index.ts"),
					readText("pnpm-workspace.yaml"),
					readJson<Manifest>(
						join(workspace.projectRoot, ".forge/manifest.json"),
					),
				]);

			expect(auth).toContain(
				'import { drizzleAdapter } from "better-auth/adapters/drizzle";',
			);

			expect(auth).toContain('import { db } from "@acme/db/client";');
			expect(auth).toContain("database: drizzleAdapter(db, {");
			expect(auth).toContain('provider: "pg",');
			expect(auth).not.toContain("prismaAdapter");
			expect(auth).not.toContain("__SLUG__");

			expect(authSchema).toContain(
				'import { index, snakeCase, text, timestamp } from "drizzle-orm/pg-core";',
			);

			expect(authSchema).toContain(
				'export const sessions = snakeCase.table(\n  "sessions"',
			);

			expect(authSchema).toContain(
				'export const accounts = snakeCase.table(\n  "accounts"',
			);

			expect(authSchema).toContain(
				'.references(() => users.id, { onDelete: "cascade" })',
			);

			expect(authSchema).toContain("sessions_user_id_idx");
			expect(authSchema).toContain("accounts_user_id_idx");

			expect(schemaIndex).toContain('export * from "./auth";');

			expect(workspaceYaml).toContain("allowBuilds:");
			expect(workspaceYaml).toContain("esbuild: true");
			expect(workspaceYaml).not.toContain("prisma: true");
			expect(workspaceYaml).not.toContain('"@prisma/engines": true');

			const installs = manifest.installs.map((entry) => entry.definitionId);
			expect(installs).toContain("drizzle");
			expect(installs).toContain("better-auth");
			expect(installs).not.toContain("prisma");
		});
	}, 120_000);

	const pluginVariants = [
		{
			name: "drizzle postgres",
			config: { database: "postgresql", orm: "drizzle" },
			user: "packages/db/src/schema/users/users.ts",
			session: "packages/db/src/schema/auth.ts",
			columns: [
				"username: text().unique(),",
				"displayUsername: text(),",
				"banned: boolean().default(false),",
				"banExpires: timestamp({ withTimezone: true }),",
				"impersonatedBy: text(),",
			],
		},
		{
			name: "drizzle mysql",
			config: { database: "mysql", orm: "drizzle" },
			user: "packages/db/src/schema/users/users.ts",
			session: "packages/db/src/schema/auth.ts",
			columns: [
				"username: varchar({ length: 255 }).unique(),",
				"displayUsername: text(),",
				"banned: boolean().default(false),",
				"banExpires: timestamp({ fsp: 3 }),",
				"impersonatedBy: text(),",
			],
		},
		{
			name: "drizzle planetscale mysql",
			config: {
				database: "mysql",
				databaseProvider: "planetscale",
				orm: "drizzle",
			},
			user: "packages/db/src/schema/users/users.ts",
			session: "packages/db/src/schema/auth.ts",
			columns: [
				"username: varchar({ length: 255 }).unique(),",
				"banExpires: timestamp({ fsp: 3 }),",
				"impersonatedBy: text(),",
			],
		},
		{
			name: "drizzle sqlite",
			config: { database: "sqlite", orm: "drizzle" },
			user: "packages/db/src/schema/users/users.ts",
			session: "packages/db/src/schema/auth.ts",
			columns: [
				"username: text().unique(),",
				'banned: integer({ mode: "boolean" }).default(false),',
				'banExpires: integer({ mode: "timestamp_ms" }),',
				"impersonatedBy: text(),",
			],
		},
		{
			name: "prisma postgres",
			config: { database: "postgresql", orm: "prisma" },
			user: "packages/db/prisma/schema.prisma",
			session: "packages/db/prisma/schema.prisma",
			columns: [
				/username\s+String\?\s+@unique\n/,
				/displayUsername\s+String\?\s+@map\("display_username"\)\n/,
				/banned\s+Boolean\?\s+@default\(false\)\n/,
				/banExpires\s+DateTime\?\s+@map\("ban_expires"\) @db\.Timestamptz\n/,
				/impersonatedBy\s+String\?\s+@map\("impersonated_by"\)\n/,
			],
		},
		{
			name: "prisma mysql",
			config: { database: "mysql", orm: "prisma" },
			user: "packages/db/prisma/schema.prisma",
			session: "packages/db/prisma/schema.prisma",
			columns: [
				/username\s+String\?\s+@unique\n/,
				/displayUsername\s+String\?\s+@map\("display_username"\) @db\.Text\n/,
				/impersonatedBy\s+String\?\s+@map\("impersonated_by"\) @db\.Text\n/,
			],
		},
		{
			name: "prisma sqlite",
			config: { database: "sqlite", orm: "prisma" },
			user: "packages/db/prisma/schema.prisma",
			session: "packages/db/prisma/schema.prisma",
			columns: [
				/username\s+String\?\s+@unique\n/,
				/banExpires\s+DateTime\?\s+@map\("ban_expires"\)\n/,
				/impersonatedBy\s+String\?\s+@map\("impersonated_by"\)\n/,
			],
		},
	] as const;

	it.each(pluginVariants)(
		"generates username, admin, two-factor and organization for $name",
		async ({ name, config, user, session, columns }) => {
			await withScenarioWorkspace(
				`better-auth-plugins-${name.replaceAll(" ", "-")}`,
				async (workspace) => {
					await createProject(workspace, {
						...config,
						authentication: "better-auth",
						authMethods: ["email-password", "google"],
						authPlugins: ["admin", "username", "two-factor", "organization"],
						linter: "biome",
						packageManager: "pnpm",
						style: "tailwind",
						web: "nextjs",
					});

					const readText = (path: string) =>
						readFile(join(workspace.projectRoot, path), "utf-8");

					const [auth, client, userSchema, sessionSchema] = await Promise.all([
						readText("packages/auth/src/index.ts"),
						readText("packages/auth/src/client.ts"),
						readText(user),
						readText(session),
					]);

					expect(auth).toMatch(
						/twoFactor\(\),\s+username\(\),\s+admin\(\),\s+organization\(\{/,
					);

					expect(auth).toContain("nextCookies()");
					expect(auth).toContain(
						"async sendInvitationEmail({ id, email, organization })",
					);

					expect(auth).toContain("console.log(`Invitation");

					for (const plugin of [
						"twoFactorClient",
						"usernameClient",
						"adminClient",
						"organizationClient",
					])
						expect(client).toContain(`${plugin}()`);

					const schemas = `${userSchema}\n${sessionSchema}`;
					for (const column of columns)
						if (typeof column === "string") expect(schemas).toContain(column);
						else expect(schemas).toMatch(column);

					if (config.orm === "drizzle") {
						for (const table of [
							"two_factors",
							"organizations",
							"members",
							"invitations",
						])
							expect(sessionSchema).toContain(`export const ${table}`);

						expect(userSchema).toContain("twoFactorEnabled:");
						expect(sessionSchema).toContain("activeOrganizationId: text(),");
						expect(sessionSchema).toContain('index("two_factors_secret_idx")');
						expect(sessionSchema.includes('index("members_user_id_idx")')).toBe(
							config.database !== "mysql" || name.includes("planetscale"),
						);

						const relations = await readText(
							"packages/db/src/schema/relations.ts",
						);

						expect(relations).toContain("twoFactors: r.many.two_factors({");
						expect(relations).toContain("from: r.organizations.id,");
						expect(relations).toContain("inviter: r.one.users({");
					} else {
						for (const model of [
							"TwoFactor",
							"Organization",
							"Member",
							"Invitation",
						])
							expect(sessionSchema).toContain(`model ${model} {`);

						expect(sessionSchema).toContain("twoFactors TwoFactor[]");
						expect(sessionSchema).toContain("members Member[]");
						expect(sessionSchema).toContain("invitations Invitation[]");
						expect(sessionSchema).toContain("@@index([organizationId])");
						expect(sessionSchema).not.toContain("slug String @unique @db.Text");
					}

					for (const text of [auth, client, userSchema, sessionSchema])
						expect(text).not.toMatch(/__[A-Z_]+__/);
				},
			);
		},
		120_000,
	);
});
