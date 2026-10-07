import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	addAddon,
	createProject,
	pathExists,
	readJson,
	removeAddon,
	tryRunForge,
	withScenarioWorkspace,
} from "../utils/harness";

const baseConfig = {
	authentication: "better-auth",
	database: "postgresql",
	linter: "biome",
	orm: "drizzle",
	packageManager: "pnpm",
	style: "tailwind",
	web: "nextjs",
};

async function treeHashes(projectRoot: string) {
	const entries = await readdir(projectRoot, {
		recursive: true,
		withFileTypes: true,
	});

	const hashes: Record<string, string> = {};
	for (const entry of entries) {
		if (!entry.isFile()) continue;

		const path = join(entry.parentPath, entry.name);
		hashes[relative(projectRoot, path)] = createHash("sha256")
			.update(await readFile(path))
			.digest("hex");
	}

	return hashes;
}

describe("auth choice lifecycle", () => {
	it("removes Email OTP artifacts before removing email", async () => {
		await withScenarioWorkspace("auth-choice-email-otp", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				authMethods: ["email-password", "email-otp"],
				emailProvider: "resend",
			});

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const files = await readdir(workspace.projectRoot, { recursive: true });
			const templates = files.filter((path) =>
				path.endsWith("verification-code.tsx"),
			);

			expect(templates).toEqual([
				"packages/email/src/templates/verification-code.tsx",
			]);

			expect(await readText("packages/auth/src/index.ts")).toContain(
				"emailOTP(",
			);

			expect(await readText("packages/auth/src/client.ts")).toContain(
				"emailOTPClient(",
			);

			expect(await readText("packages/email/src/messages.ts")).toContain(
				"verificationCode",
			);

			await removeAddon(workspace.projectRoot, "email-otp");

			expect(await readText("packages/auth/src/index.ts")).not.toContain(
				"emailOTP(",
			);

			expect(await readText("packages/auth/src/index.ts")).not.toContain(
				"sendVerificationOTP",
			);

			expect(await readText("packages/auth/src/client.ts")).not.toContain(
				"emailOTPClient(",
			);

			expect(await readText("packages/email/src/messages.ts")).not.toContain(
				"verificationCode",
			);

			for (const template of templates)
				expect(await pathExists(join(workspace.projectRoot, template))).toBe(
					false,
				);

			const manifest = await readJson<{
				readonly config: { readonly authMethods: ReadonlyArray<string> };
			}>(join(workspace.projectRoot, ".forge/manifest.json"));

			expect(manifest.config.authMethods).toEqual(["email-password"]);

			const removed = await removeAddon(workspace.projectRoot, "email");

			expect(removed.exitCode).toBe(0);
		});
	});

	it("adds Two-factor schema and client plugins and Google env vars", async () => {
		await withScenarioWorkspace("auth-choice-two-factor", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				authMethods: ["email-password"],
			});

			const readText = (path: string) =>
				readFile(join(workspace.projectRoot, path), "utf-8");

			const added = await addAddon(workspace.projectRoot, "two-factor");

			expect(await readText("packages/auth/src/index.ts")).toContain(
				"twoFactor(",
			);

			expect(await readText("packages/auth/src/client.ts")).toContain(
				"twoFactorClient(",
			);

			const schema = await readText("packages/db/src/schema/auth.ts");
			expect(schema).toContain("export const two_factors");
			expect(await readText("packages/db/src/schema/users/users.ts")).toContain(
				"twoFactorEnabled:",
			);

			expect(added.stdout).toContain(
				'Two-factor changes your auth schema, so run "pnpm --filter @acme/db run push" to update your database.',
			);

			const database = await readJson<{
				readonly scripts: { readonly push: string };
			}>(join(workspace.projectRoot, "packages/db/package.json"));

			expect(database.scripts.push).toContain("drizzle-kit push");

			await addAddon(workspace.projectRoot, "google");

			const env = await readText(".env.example");
			expect(env).toContain("AUTH_GOOGLE_CLIENT_ID");
			expect(env).toContain("AUTH_GOOGLE_CLIENT_SECRET");
		});
	});

	it("refuses incompatible Two-factor without changing a single file", async () => {
		await withScenarioWorkspace("auth-choice-refusal", async (workspace) => {
			await createProject(workspace, {
				...baseConfig,
				authMethods: ["email-password", "magic-link"],
				emailProvider: "resend",
			});

			const before = await treeHashes(workspace.projectRoot);

			const refused = await tryRunForge(
				workspace.projectRoot,
				["add", "two-factor"],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			expect(refused.exitCode).not.toBe(0);
			expect(`${refused.stdout}\n${refused.stderr}`).toContain(
				"Two-factor doesn't work with Magic link, because that sign-in skips the second factor.",
			);

			expect(await treeHashes(workspace.projectRoot)).toEqual(before);
		});
	});
});
