import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import {
	commitFixture,
	createProject,
	expectCleanTree,
	expectInstallBuildAndTypecheck,
	expectRun,
	runCommand,
	runForge,
	withScenarioWorkspace,
} from "../utils/harness";
import {
	bundleText,
	expectCredentialedGeneratedServer,
	expectEmailPreview,
	expectInvitationFlow,
	expectProductionEmailSecrets,
	expectProductionOrigins,
	expectRelocatedPasskeyCeremony,
	expectSchemaPush,
	readGeneratedEnv,
	scriptEnvironment,
	signUpSession,
	webAppsOf,
	withGeneratedServer,
	withWebApp,
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
				},
			);
		},
		600_000,
	);

	it.each(["trpc", "orpc"] as const)(
		"installs secondary %s clients and accepts their credentialed requests",
		async (rpc) => {
			await withScenarioWorkspace(
				`smoke-secondary-client-${rpc}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						authMethods: ["email-password", "passkey"],
						backend: "hono",
						database: "sqlite",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc,
						web: "tanstack-router",
						webApps: [{ name: "admin", framework: "nextjs", client: true }],
						style: "tailwind",
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc,
						clientOrigin: "http://localhost:3002",
						passkey: true,
					});

					await expectRelocatedPasskeyCeremony(workspace.projectRoot);

					await expectProductionOrigins(workspace.projectRoot, {
						host: "server",
						paths:
							rpc === "trpc"
								? ["/api/auth/get-session", "/api/trpc/health"]
								: ["/api/auth/get-session"],
						passkeyProbe: true,
					});
				},
			);
		},
		600_000,
	);

	it("starts TanStack Router and Next.js apps on their ports and accepts sign up from the primary origin on Hono", async () => {
		await withScenarioWorkspace("smoke-web-apps-started", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password"],
				backend: "hono",
				database: "sqlite",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				linter: "biome",
				web: "tanstack-router",
				webApps: [{ name: "admin", framework: "nextjs" }],
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");

			const projectRoot = workspace.projectRoot;
			const apps = await webAppsOf(projectRoot);
			expect(apps).toHaveLength(2);
			expect(apps.filter((app) => app.primary)).toHaveLength(1);

			const primary = apps.find((app) => app.primary);
			const secondary = apps.find((app) => !app.primary);
			if (primary === undefined || secondary === undefined)
				throw new Error(`Missing Web Apps: ${projectRoot}`);

			expect(primary.framework).toBe("tanstack-router");
			expect(secondary.framework).toBe("nextjs");
			expect(primary.port).not.toBe(secondary.port);

			const generatedEnv = await readGeneratedEnv(projectRoot);
			const apiOrigin = generatedEnv.APP_ORIGIN;
			if (apiOrigin === undefined)
				throw new Error(`Missing Generated Origin: ${projectRoot}`);

			expect(
				await bundleText(join(projectRoot, primary.root, "dist")),
			).toContain(apiOrigin);

			await expectSchemaPush(projectRoot);

			await withGeneratedServer(
				projectRoot,
				generatedEnv,
				apiOrigin,
				async (output) => {
					await withWebApp(projectRoot, primary, async (primaryOutput) => {
						await withWebApp(
							projectRoot,
							secondary,
							async (secondaryOutput) => {
								for (const app of apps) {
									const page = await fetch(`http://localhost:${app.port}/`);
									const html = await page.text();
									expect(
										page.status,
										`${primaryOutput()}\n${secondaryOutput()}`,
									).toBe(200);

									expect(page.headers.get("content-type")).toContain(
										"text/html",
									);

									expect(html).toMatch(/<html[\s>]/i);
								}

								const primaryOrigin = `http://localhost:${primary.port}`;
								const session = await signUpSession(
									apiOrigin,
									primaryOrigin,
									"web-apps@example.com",
									output,
								);

								const health = await fetch(
									`${apiOrigin}/api/trpc/health?input=%7B%7D`,
									{
										headers: {
											Cookie: session.cookie,
											Origin: primaryOrigin,
											"x-trpc-source": "smoke",
										},
									},
								);

								expect(
									health.status,
									`${await health.text()}\n${output()}`,
								).toBe(200);

								expect(health.headers.get("access-control-allow-origin")).toBe(
									primaryOrigin,
								);

								expect(
									health.headers.get("access-control-allow-credentials"),
								).toBe("true");
							},
						);
					});
				},
			);
		});
	}, 600_000);

	it("accepts a client added later once .env holds the printed WEB_URLS", async () => {
		await withScenarioWorkspace("smoke-added-client", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password"],
				backend: "hono",
				database: "sqlite",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
				webApps: [
					{ name: "admin", framework: "tanstack-router", client: true },
				],
			});

			const added = await runForge(
				workspace.projectRoot,
				[
					"add",
					"tanstack-router",
					"--name",
					"portal",
					"--client",
					"--yes",
					"--no-install",
				],
				{ workspaceRoot: workspace.workspaceRoot },
			);

			const printed =
				/Add http:\/\/localhost:3003 to WEB_URLS in \.env so portal can call the API\. With only local apps, that makes WEB_URLS="([^"]+)"\./.exec(
					added.stdout,
				)?.[1];

			expect(printed, added.stdout).toBe(
				"http://localhost:3002,http://localhost:3003",
			);

			const apiOrigin = "http://localhost:48301";
			const envPath = join(workspace.projectRoot, ".env");
			const env = await readFile(envPath, "utf-8");
			expect(env).not.toContain("http://localhost:3003");

			await writeFile(
				envPath,
				`${env
					.replace(/^WEB_URLS=.*$/m, `WEB_URLS="${printed}"`)
					.replace(
						/^APP_ORIGIN=.*$/m,
						`APP_ORIGIN="${apiOrigin}"`,
					)}PORT="48301"\n`,
			);

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				apiOrigin,
				clientOrigin: "http://localhost:3003",
			});
		});
	}, 600_000);

	it("answers get-session on the default self-hosted Next.js project", async () => {
		await withScenarioWorkspace(
			"smoke-default-self-nextjs",
			async (workspace) => {
				await createProject(workspace, {
					authentication: "better-auth",
					backend: "self",
					database: "sqlite",
					orm: "drizzle",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				});

				await expectInstallBuildAndTypecheck(workspace, "pnpm");
				await expectSchemaPush(workspace.projectRoot);

				const origin = "http://localhost:47400";
				const generatedEnv = {
					...(await readGeneratedEnv(workspace.projectRoot)),
					APP_ORIGIN: origin,
				};

				await withGeneratedServer(
					workspace.projectRoot,
					generatedEnv,
					origin,
					async (output) => {
						const session = await fetch(`${origin}/api/auth/get-session`);
						expect(session.status, output()).toBe(200);
						expect(await session.json()).toBeNull();
					},
					"nextjs",
				);

				await expectRun(workspace, "git", ["init", "-q"]);
				await commitFixture(workspace);

				await withGeneratedServer(
					workspace.projectRoot,
					{ ...generatedEnv, PORT: new URL(origin).port },
					origin,
					async (output) => {
						const response = await fetch(`${origin}/`);
						expect(response.status, output()).toBe(200);
					},
					"nextjs",
					"dev",
				);

				await expectCleanTree(workspace);

				await expectRun(workspace, "pnpm", ["typecheck"]);
				await expectCleanTree(workspace);
			},
		);
	}, 600_000);

	it("installs self-hosted RPC and auth with a secondary client", async () => {
		await withScenarioWorkspace(
			"smoke-secondary-client-self",
			async (workspace) => {
				await createProject(workspace, {
					authentication: "better-auth",
					authMethods: ["email-password", "passkey"],
					backend: "self",
					database: "sqlite",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					web: "nextjs",
					webApps: [{ name: "admin", framework: "nextjs", client: true }],
					style: "tailwind",
				});

				await expectInstallBuildAndTypecheck(workspace, "pnpm");
				await expectCredentialedGeneratedServer(workspace.projectRoot, {
					clientOrigin: "http://localhost:3002",
					host: "nextjs",
				});

				const ciBuild = await runCommand("pnpm", ["run", "build"], {
					cwd: join(workspace.projectRoot, "apps/web"),
					env: scriptEnvironment({ CI: "1", WEB_URLS: "" }),
				});

				expect(ciBuild.exitCode, `${ciBuild.stdout}\n${ciBuild.stderr}`).toBe(
					0,
				);

				await expectProductionOrigins(workspace.projectRoot, {
					host: "nextjs",
					paths: ["/api/auth/get-session", "/api/trpc/health"],
					passkeyProbe: false,
				});
			},
		);
	}, 600_000);

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
