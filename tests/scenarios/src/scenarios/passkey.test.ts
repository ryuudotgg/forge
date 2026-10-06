import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProject, withScenarioWorkspace } from "../utils/harness";
import { passkeySchemaBlock } from "../utils/schema";

const variants = [
	{ name: "drizzle postgres", orm: "drizzle", database: "postgresql" },
	{ name: "drizzle mysql", orm: "drizzle", database: "mysql" },
	{
		name: "drizzle planetscale",
		orm: "drizzle",
		database: "mysql",
		databaseProvider: "planetscale",
	},
	{ name: "drizzle sqlite", orm: "drizzle", database: "sqlite" },
	{ name: "prisma postgres", orm: "prisma", database: "postgresql" },
	{ name: "prisma mysql", orm: "prisma", database: "mysql" },
	{
		name: "prisma planetscale",
		orm: "prisma",
		database: "mysql",
		databaseProvider: "planetscale",
	},
	{ name: "prisma sqlite", orm: "prisma", database: "sqlite" },
];

describe("passkey", () => {
	it.each(variants)(
		"generates a complete passkey setup for $name",
		async ({ name, ...config }) => {
			await withScenarioWorkspace(
				`passkey-${name.replaceAll(" ", "-")}`,
				async (workspace) => {
					await createProject(workspace, {
						...config,
						authentication: "better-auth",
						authMethods: ["email-password", "passkey"],
						linter: "biome",
						packageManager: "pnpm",
						web: "nextjs",
					});

					const readText = (path: string) =>
						readFile(join(workspace.projectRoot, path), "utf-8");

					const [auth, client, options, schema, workspaceYaml] =
						await Promise.all([
							readText("packages/auth/src/index.ts"),
							readText("packages/auth/src/client.ts"),
							readText("packages/auth/src/passkey.ts"),
							readText(
								config.orm === "drizzle"
									? "packages/db/src/schema/auth.ts"
									: "packages/db/prisma/schema.prisma",
							),
							readText("pnpm-workspace.yaml"),
						]);

					expect(auth).toContain("passkeyPlugin()");
					expect(client).toContain("passkeyClient()");
					expect(options).toContain("PasskeyOptions");
					expect(workspaceYaml).toContain("@better-auth/passkey");

					const passkeyTable = passkeySchemaBlock(
						schema,
						config.orm === "drizzle" ? "drizzle" : "prisma",
					);

					for (const field of [
						"name",
						"publicKey",
						"userId",
						"credentialID",
						"counter",
						"deviceType",
						"backedUp",
						"transports",
						"createdAt",
						"aaguid",
					])
						expect(passkeyTable).toContain(field);

					if (config.orm === "drizzle") {
						expect(auth).toContain("passkey: passkeys");
						expect(passkeyTable).toContain("passkeys_credential_id_idx");
						expect(passkeyTable.includes("passkeys_user_id_idx")).toBe(
							config.database !== "mysql" ||
								config.databaseProvider === "planetscale",
						);
					} else {
						expect(schema).toMatch(/passkeys\s+Passkey\[\]/);
						expect(passkeyTable).toContain("@@index([credentialID");
						expect(passkeyTable).toContain("@@index([userId");
					}

					for (const content of [auth, client, options, schema])
						expect(content).not.toMatch(/__[A-Z_]+__/);
				},
			);
		},
		120_000,
	);
});
