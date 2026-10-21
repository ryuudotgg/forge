import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	backend: "hono",
	name: "Acme",
	packageManager: "pnpm",
	platforms: ["web"],
	runtime: "Node.js",
	slug: "acme",
	web: "nextjs",
};

const targets = {
	users: "id | email, emailVerified | name, image | createdAt, updatedAt",
	pluginUsers:
		"id | email, emailVerified | name, image | twoFactorEnabled | username, displayUsername | role, banned, banReason, banExpires | createdAt, updatedAt",
	pluginSessions:
		"id, userId | token, expiresAt | ipAddress, userAgent | impersonatedBy | activeOrganizationId | createdAt, updatedAt",
	passkeys:
		"id, userId | name, publicKey | credentialID | counter, deviceType, backedUp | transports, aaguid | createdAt",
	two_factors:
		"id, userId | secret, backupCodes | verified, failedVerificationCount, lockedUntil",
	organizations: "id | name, slug, logo | metadata | createdAt",
	members: "id, organizationId, userId | role | createdAt",
	invitations:
		"id, organizationId, inviterId | email, role | status, expiresAt | createdAt",
};

const pluginTables = [
	{ table: "passkeys", model: "Passkey", target: targets.passkeys },
	{ table: "two_factors", model: "TwoFactor", target: targets.two_factors },
	{
		table: "organizations",
		model: "Organization",
		target: targets.organizations,
	},
	{ table: "members", model: "Member", target: targets.members },
	{ table: "invitations", model: "Invitation", target: targets.invitations },
];

const prismaScalars = new Set(["String", "Int", "Boolean", "DateTime"]);

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

function layout(groups: ReadonlyArray<ReadonlyArray<string>>): string {
	return groups.map((group) => group.join(", ")).join(" | ");
}

function drizzleLayout(content: string, table: string): string {
	const start = content.search(
		new RegExp(`snakeCase\\.table\\(\\s*"${table}",\\s*\\{\\n`),
	);

	if (start === -1) throw new Error(`Missing Drizzle Table: ${table}`);

	const body = content.slice(content.indexOf("{\n", start) + 2);
	const lines = body
		.slice(0, body.search(/^\s*\}/m))
		.replace(/\n$/, "")
		.split("\n");

	const groups: Array<Array<string>> = [[]];
	for (const line of lines) {
		if (line.trim() === "") {
			groups.push([]);
			continue;
		}

		const field = /^\s+(\w+):/.exec(line)?.[1];
		if (field !== undefined) groups.at(-1)?.push(field);
	}

	return layout(groups);
}

function prismaLayout(content: string, model: string): string {
	const start = content.indexOf(`model ${model} {\n`);
	if (start === -1) throw new Error(`Missing Prisma Model: ${model}`);

	const body = content.slice(start, content.indexOf("\n}", start));
	const groups = body
		.split("\n")
		.slice(1)
		.join("\n")
		.split(/\n\s*\n/)
		.map((group) =>
			group.split("\n").flatMap((line) => {
				const [name, type] = line.trim().split(/\s+/);
				const scalar = type?.replace("?", "");
				return name !== undefined &&
					scalar !== undefined &&
					prismaScalars.has(scalar)
					? [name]
					: [];
			}),
		)
		.filter((group) => group.length > 0);

	return layout(groups);
}

describe("auth table layout", () => {
	it("groups Postgres Drizzle users and passkeys for passkey with email OTP", async () => {
		const plan = await plannedProject({
			...baseConfig,
			authMethods: ["passkey", "email-otp"],
			emailProvider: "resend",
			orm: "drizzle",
			database: "postgresql",
		});

		const users = writeContent(plan, "packages/db/src/schema/users/users.ts");
		const auth = writeContent(plan, "packages/db/src/schema/auth.ts");

		expect(drizzleLayout(users, "users")).toBe(targets.users);
		expect(drizzleLayout(auth, "passkeys")).toBe(targets.passkeys);
	});

	const dialects: ReadonlyArray<{ name: string; config: ForgeConfig }> = [
		{ name: "Postgres", config: { database: "postgresql" } },
		{ name: "MySQL", config: { database: "mysql" } },
		{
			name: "PlanetScale",
			config: { database: "mysql", databaseProvider: "planetscale" },
		},
		{ name: "SQLite", config: { database: "sqlite" } },
	];

	const pluginConfig: ForgeConfig = {
		...baseConfig,
		authMethods: ["email-password", "passkey"],
		authPlugins: ["two-factor", "username", "admin", "organization"],
	};

	describe.each(dialects)("$name", (dialect) => {
		it("groups every plugin table under Drizzle", async () => {
			const plan = await plannedProject({
				...pluginConfig,
				...dialect.config,
				orm: "drizzle",
			});

			const users = writeContent(plan, "packages/db/src/schema/users/users.ts");
			const auth = writeContent(plan, "packages/db/src/schema/auth.ts");
			for (const content of [users, auth])
				expect(content).not.toMatch(/\{\n\s*\n|\n\s*\n\s*\n|\n\s*\n\s*\}/);

			expect(drizzleLayout(users, "users")).toBe(targets.pluginUsers);
			expect(drizzleLayout(auth, "sessions")).toBe(targets.pluginSessions);

			for (const { table, target } of pluginTables)
				expect(drizzleLayout(auth, table)).toBe(target);
		});

		it("orders and groups every plugin model under Prisma", async () => {
			const plan = await plannedProject({
				...pluginConfig,
				...dialect.config,
				orm: "prisma",
			});

			const schema = writeContent(plan, "packages/db/prisma/schema.prisma");

			expect(schema).not.toMatch(/\{\n\s*\n|\n\s*\n\s*\n|\n\s*\n\}/);

			expect(prismaLayout(schema, "User")).toBe(targets.pluginUsers);
			expect(prismaLayout(schema, "Session")).toBe(targets.pluginSessions);

			for (const { model, target } of pluginTables)
				expect(prismaLayout(schema, model)).toBe(target);
		});
	});
});
