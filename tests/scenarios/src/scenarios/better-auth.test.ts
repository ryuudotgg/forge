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

			const [auth, authSchema, workspaceYaml, manifest] = await Promise.all([
				readText("packages/auth/src/index.ts"),
				readText("packages/db/src/schema/auth.ts"),
				readText("pnpm-workspace.yaml"),
				readJson<Manifest>(join(workspace.projectRoot, ".forge/manifest.json")),
			]);

			expect(auth).toContain(
				'import { drizzleAdapter } from "better-auth/adapters/drizzle";',
			);
			expect(auth).toContain("database: drizzleAdapter(db, {");
			expect(auth).not.toContain("prismaAdapter");

			expect(authSchema).toContain(
				'export const sessions = pgTable("sessions"',
			);

			expect(workspaceYaml).not.toContain("prisma: true");
			expect(workspaceYaml).not.toContain('"@prisma/engines": true');

			const installs = manifest.installs.map((entry) => entry.definitionId);
			expect(installs).toContain("drizzle");
			expect(installs).toContain("better-auth");
			expect(installs).not.toContain("prisma");
		});
	}, 120_000);
});
