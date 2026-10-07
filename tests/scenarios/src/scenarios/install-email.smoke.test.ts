import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallBuildAndTypecheck,
	runCommand,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	expectCredentialedGeneratedServer,
	expectEmailPreview,
	expectInvitationFlow,
	expectOtpSendTiming,
	expectProductionEmailSecrets,
} from "../utils/install-smoke";

// tsx watch restarts when another worker hardlinks the same pnpm store inode.
const watchedInstallEnv = { pnpm_config_package_import_method: "copy" };

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it.each([
		{ backend: "hono", web: "nextjs", emailProvider: "resend" },
		{ backend: "fastify", web: "tanstack-router", emailProvider: "postmark" },
		{ backend: "express", web: "tanstack-router", emailProvider: "smtp" },
	])(
		"installs and authenticates email methods on $backend with $emailProvider",
		async ({ backend, web, emailProvider }) => {
			await withScenarioWorkspace(
				`smoke-email-auth-${backend}`,
				async (workspace) => {
					await createProject(workspace, {
						addons: ["vitest"],
						authentication: "better-auth",
						authMethods: ["email-password", "email-otp", "magic-link"],
						backend,
						database: "sqlite",
						emailProvider,
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "trpc",
						style: "tailwind",
						web,
					});

					await writeFile(
						join(workspace.projectRoot, "packages/auth/src/email-probe.ts"),
						[
							'import { authClient } from "./client";',
							"export const sendOtp = authClient.emailOtp.sendVerificationOtp;",
							"export const signInOtp = authClient.signIn.emailOtp;",
							"export const signInMagic = authClient.signIn.magicLink;",
							"",
						].join("\n"),
					);

					const installResult = await expectInstallBuildAndTypecheck(
						workspace,
						"pnpm",
						watchedInstallEnv,
					);

					const deprecatedEmailLines = stripVTControlCharacters(
						`${installResult.stdout}\n${installResult.stderr}`,
					)
						.split("\n")
						.filter(
							(line) => /deprecated/i.test(line) && /react-email/.test(line),
						);

					expect(
						deprecatedEmailLines,
						`Deprecated React Email packages during install:\n${deprecatedEmailLines.join("\n")}`,
					).toEqual([]);

					const emailTest = await runCommand("pnpm", ["test"], {
						cwd: join(workspace.projectRoot, "packages/email"),
						env: { FORCE_COLOR: "0", NO_COLOR: "1" },
					});

					expect(
						emailTest.exitCode,
						`${emailTest.stdout}\n${emailTest.stderr}`,
					).toBe(0);

					expect(emailTest.stdout).toMatch(/Tests\s+2 passed/);

					await expectEmailPreview(workspace.projectRoot);

					const declarations = await runCommand(
						"pnpm",
						[
							"exec",
							"tsc",
							"--emitDeclarationOnly",
							"--outDir",
							join(workspace.workspaceRoot, "auth-declarations"),
						],
						{ cwd: join(workspace.projectRoot, "packages/auth") },
					);

					expect(
						declarations.exitCode,
						`${declarations.stdout}\n${declarations.stderr}`,
					).toBe(0);

					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						emailAuth: true,
						launch: "dev",
					});

					await expectProductionEmailSecrets(workspace.projectRoot);
					if (backend === "express")
						await expectOtpSendTiming(workspace.projectRoot, "server");
				},
			);
		},
		600_000,
	);

	it("invites through the accept page and names the project in authenticators", async () => {
		await withScenarioWorkspace("smoke-invitations", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password"],
				authPlugins: ["two-factor", "organization"],
				backend: "self",
				database: "sqlite",
				linter: "biome",
				name: "Acme Works",
				orm: "drizzle",
				packageManager: "pnpm",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectInvitationFlow(workspace.projectRoot, "Acme Works");
		});
	}, 600_000);
});
