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
				'import { snakeCase, text, timestamp } from "drizzle-orm/pg-core";',
			);
			expect(authSchema).toContain(
				'export const sessions = snakeCase.table("sessions"',
			);
			expect(authSchema).toContain(
				'export const accounts = snakeCase.table("accounts"',
			);
			expect(authSchema).toContain(
				'.references(() => users.id, { onDelete: "cascade" })',
			);

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
});
