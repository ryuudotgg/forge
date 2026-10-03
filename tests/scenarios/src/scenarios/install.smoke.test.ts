import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallAndTypecheck,
	expectInstallBuildAndTypecheck,
	type ForgeCommandResult,
	forgeEnvironment,
	pathExists,
	runCommand,
	type ScenarioProject,
	withScenarioWorkspace,
} from "../utils/harness";

const postgresProviderCells = [
	{ provider: "planetscale", transaction: "supported" },
	{ provider: "neon", transaction: "unsupported" },
	{ provider: "nile", transaction: "supported" },
	{ provider: "supabase", transaction: "supported" },
	{ provider: "prisma-postgres", transaction: "supported" },
] as const satisfies ReadonlyArray<{
	readonly provider: string;
	readonly transaction: "supported" | "unsupported";
}>;

const transactionProbeSource = `import { db } from "@acme/db/client";
import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";

const probe = pgTable("forge_smoke", {
  id: integer().primaryKey(),
  label: text().notNull(),
});

const rows = await db.transaction(async (tx) => {
  await tx.execute(
    sql\`create temporary table forge_smoke (id integer primary key, label text not null) on commit drop\`,
  );

  await tx.insert(probe).values({ id: 1, label: "forge" });
  return tx.select().from(probe);
});

if (rows[0]?.label !== "forge")
  throw new Error(\`Transaction Probe Mismatch: \${JSON.stringify(rows)}\`);

process.exit(0);
`;

// Generated schema files use extensionless imports, which Node type stripping cannot resolve.
const typeScriptResolveHookSource = `import { registerHooks } from "node:module";
import { extname } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(".") || extname(specifier) !== "")
      return nextResolve(specifier, context);

    for (const candidate of [\`\${specifier}.ts\`, \`\${specifier}/index.ts\`]) {
      try {
        return nextResolve(candidate, context);
      } catch {}
    }

    return nextResolve(specifier, context);
  },
});
`;

function smokeDatabaseUrl() {
	const url = process.env.FORGE_SMOKE_DATABASE_URL;
	if (url === undefined)
		throw new Error("Missing Smoke Database: FORGE_SMOKE_DATABASE_URL");

	return url;
}

async function runTransactionProbe(
	workspace: ScenarioProject,
	url: string,
): Promise<ForgeCommandResult> {
	const hookPath = join(workspace.workspaceRoot, "ts-resolve.mjs");
	await writeFile(hookPath, typeScriptResolveHookSource);

	return await runCommand(
		"node",
		["--import", hookPath, "src/transaction-probe.ts"],
		{
			cwd: join(workspace.projectRoot, "packages/db"),
			env: {
				...forgeEnvironment(workspace.workspaceRoot),
				DATABASE_URL: url,
				DATABASE_DIRECT_URL: url,
			},
		},
	);
}

async function readGeneratedEnv(projectRoot: string) {
	const content = await readFile(join(projectRoot, ".env"), "utf-8");
	const env: NodeJS.ProcessEnv = {};
	for (const line of content.split("\n")) {
		const match = /^([A-Z_]+)="([^"]*)"\s*(?:#.*)?$/.exec(line);
		const name = match?.[1];
		const value = match?.[2];
		if (name !== undefined && value !== undefined) env[name] = value;
	}

	return env;
}

async function expectCredentialedGeneratedServer(
	projectRoot: string,
	rpc: "trpc" | "orpc" = "trpc",
) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const origin = generatedEnv.WEB_URL;
	const serverOrigin = generatedEnv.APP_ORIGIN;
	if (origin === undefined || serverOrigin === undefined)
		throw new Error(`Missing Generated Origins: ${projectRoot}`);

	expect(origin).toBe("http://localhost:3000");
	expect(serverOrigin).toBe("http://localhost:3001");

	const push = await runCommand("pnpm", ["db:push"], {
		cwd: join(projectRoot, "apps/web"),
	});

	expect(
		push.exitCode,
		`pnpm db:push failed with code ${push.exitCode}\n${push.stdout}\n${push.stderr}`,
	).toBe(0);

	const ambientEnv = { ...process.env };
	delete ambientEnv.CI;

	const server = spawn("node", ["dist/index.js"], {
		cwd: join(projectRoot, "apps/server"),
		env: { ...ambientEnv, ...generatedEnv },
	});

	let output = "";
	const capture = (chunk: Buffer) => {
		output += chunk.toString();
	};

	server.stdout.on("data", capture);
	server.stderr.on("data", capture);
	const exited = new Promise<void>((resolveExit) => {
		server.once("exit", () => resolveExit());
	});

	try {
		let ready = false;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			try {
				const response = await fetch(`${serverOrigin}/`);
				if (response.ok) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		expect(ready, output).toBe(true);

		if (rpc === "trpc") {
			const preflight = await fetch(`${serverOrigin}/api/trpc/health`, {
				method: "OPTIONS",
				headers: {
					Origin: origin,
					"Access-Control-Request-Headers": "x-trpc-source",
					"Access-Control-Request-Method": "GET",
				},
			});

			expect(preflight.status).toBe(204);
			expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
			expect(preflight.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);

			expect(preflight.headers.get("access-control-allow-headers")).toContain(
				"x-trpc-source",
			);

			const actual = await fetch(
				`${serverOrigin}/api/trpc/health?input=%7B%7D`,
				{
					headers: { Origin: origin, "x-trpc-source": "smoke" },
				},
			);

			expect(actual.status).toBe(200);
			expect(actual.headers.get("access-control-allow-origin")).toBe(origin);
			expect(actual.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);
		}

		const email = "hono-smoke@example.com";
		const signup = await fetch(`${serverOrigin}/api/auth/sign-up/email`, {
			body: JSON.stringify({
				email,
				name: "Hono Smoke",
				password: "forge-smoke-password",
			}),
			headers: { "Content-Type": "application/json", Origin: origin },
			method: "POST",
		});

		const signupBody = await signup.text();
		expect(signup.status, `${signupBody}\n${output}`).toBe(200);
		expect(signup.headers.get("access-control-allow-origin")).toBe(origin);
		expect(signup.headers.get("access-control-allow-credentials")).toBe("true");

		const setCookie = signup.headers.get("set-cookie");
		expect(setCookie).toBeTruthy();

		if (setCookie === null)
			throw new Error("Missing Session Cookie: Better Auth sign-up");

		const cookie = setCookie.split(";", 1)[0];
		if (cookie === undefined)
			throw new Error("Missing Cookie Value: Better Auth sign-up");

		const authSession = await fetch(`${serverOrigin}/api/auth/get-session`, {
			headers: { Cookie: cookie, Origin: origin },
		});

		expect(authSession.status).toBe(200);
		expect(authSession.headers.get("access-control-allow-origin")).toBe(origin);
		expect(authSession.headers.get("access-control-allow-credentials")).toBe(
			"true",
		);

		const session: unknown = await authSession.json();
		expect(session).toMatchObject({ user: { email } });

		if (rpc === "orpc") {
			if (
				typeof session !== "object" ||
				session === null ||
				!("user" in session) ||
				typeof session.user !== "object" ||
				session.user === null ||
				!("id" in session.user) ||
				typeof session.user.id !== "string"
			)
				throw new Error("Missing Session User: Better Auth get-session");

			await expectOrpcSession(serverOrigin, origin, cookie, session.user.id);
			await expectGeneratedOrpcClient(
				projectRoot,
				generatedEnv,
				cookie,
				session.user.id,
			);
		}
	} finally {
		if (server.exitCode === null) server.kill("SIGTERM");
		await exited;
	}
}

async function expectOrpcSession(
	serverOrigin: string,
	origin: string,
	cookie: string,
	userId: string,
) {
	const preflight = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "OPTIONS",
		headers: {
			Origin: origin,
			"Access-Control-Request-Headers": "content-type,x-csrf-token",
			"Access-Control-Request-Method": "POST",
		},
	});

	expect(preflight.status).toBe(204);
	expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
	expect(preflight.headers.get("access-control-allow-credentials")).toBe(
		"true",
	);

	expect(preflight.headers.get("access-control-allow-headers")).toContain(
		"x-csrf-token",
	);

	const headers = {
		Origin: origin,
		"Content-Type": "application/json",
		"x-csrf-token": "orpc",
	};

	const authenticated = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "POST",
		headers: { ...headers, Cookie: cookie },
		body: JSON.stringify({ json: null }),
	});

	expect(authenticated.status).toBe(200);
	expect(authenticated.headers.get("access-control-allow-origin")).toBe(origin);
	expect(authenticated.headers.get("access-control-allow-credentials")).toBe(
		"true",
	);

	expect(await authenticated.json()).toMatchObject({ json: { id: userId } });

	const forged = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "POST",
		headers: {
			Origin: origin,
			"Content-Type": "application/json",
			Cookie: cookie,
		},
		body: JSON.stringify({ json: null }),
	});

	expect(forged.status).toBe(403);

	const anonymous = await fetch(`${serverOrigin}/api/orpc/me`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: null }),
	});

	expect(anonymous.status).toBe(401);
}

const generatedOrpcClientProbe = `import { client } from "./src/orpc/client";

const cookie = process.env.SMOKE_COOKIE;
const forward = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  if (cookie) request.headers.set("cookie", cookie);
  return forward(request);
};

const health = await client.health();
const me = await client.me().then(
  (value) => ({ value }),
  (error: { status?: number }) => ({ status: error.status }),
);

console.log(JSON.stringify({ health, me }));
`;

async function expectGeneratedOrpcClient(
	projectRoot: string,
	generatedEnv: NodeJS.ProcessEnv,
	cookie: string,
	userId: string,
) {
	const webRoot = join(projectRoot, "apps/web");
	await writeFile(join(webRoot, "orpc-probe.ts"), generatedOrpcClientProbe);

	const probe = async (sessionCookie: string) => {
		const result = await runCommand(
			join(projectRoot, "apps/server/node_modules/.bin/tsx"),
			["orpc-probe.ts"],
			{ cwd: webRoot, env: { ...generatedEnv, SMOKE_COOKIE: sessionCookie } },
		);

		expect(
			result.exitCode,
			`generated oRPC client probe failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
		).toBe(0);

		const output: unknown = JSON.parse(
			result.stdout.trim().split("\n").at(-1) ?? "",
		);
		return output;
	};

	expect(await probe(cookie)).toEqual({
		health: { status: "ok" },
		me: { value: { id: userId } },
	});

	expect(await probe("")).toEqual({
		health: { status: "ok" },
		me: { status: 401 },
	});
}

async function expectDrainingWorker(projectRoot: string) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const secret = generatedEnv.WORKER_SECRET;
	if (secret === undefined)
		throw new Error(`Missing Worker Secret: ${projectRoot}`);

	const ambientEnv = { ...process.env };
	delete ambientEnv.CI;

	const worker = spawn("node", ["dist/index.js"], {
		cwd: join(projectRoot, "apps/worker"),
		env: { ...ambientEnv, ...generatedEnv },
	});

	let output = "";
	const capture = (chunk: Buffer) => {
		output += chunk.toString();
	};

	worker.stdout.on("data", capture);
	worker.stderr.on("data", capture);
	const exited = new Promise<number | null>((resolveExit) => {
		worker.once("exit", (code) => resolveExit(code));
	});

	const origin = "http://localhost:8080";
	try {
		let ready = false;
		for (let attempt = 0; attempt < 50; attempt += 1) {
			try {
				const response = await fetch(`${origin}/health`);
				if (response.ok) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		expect(ready, output).toBe(true);

		const unauthorized = await fetch(`${origin}/run`, { method: "POST" });
		expect(unauthorized.status).toBe(401);

		const triggered = await fetch(`${origin}/run`, {
			headers: { Authorization: `Bearer ${secret}` },
			method: "POST",
		});

		expect(triggered.status, output).toBe(200);
		expect(await triggered.json()).toEqual({ ok: true });

		const idle = await fetch(`${origin}/health`);
		expect(idle.status, output).toBe(200);
		expect(await idle.json()).toMatchObject({ inFlight: 0, ok: true });
	} finally {
		if (worker.exitCode === null) worker.kill("SIGTERM");
	}

	expect(await exited, output).toBe(0);
}

async function expectBundledNativeWindStyles(workspace: ScenarioProject) {
	const mobileRoot = join(workspace.projectRoot, "apps/mobile");
	const outputDir = join(mobileRoot, "dist-export");

	const exported = await runCommand(
		"pnpm",
		[
			"exec",
			"expo",
			"export",
			"--platform",
			"ios",
			"--no-bytecode",
			"--output-dir",
			outputDir,
		],
		{ cwd: mobileRoot, env: forgeEnvironment(workspace.workspaceRoot) },
	);

	expect(
		exported.exitCode,
		`expo export failed with code ${exported.exitCode}\n${exported.stdout}\n${exported.stderr}`,
	).toBe(0);

	const bundleRoot = join(outputDir, "_expo", "static", "js", "ios");
	const bundleName = (await readdir(bundleRoot)).find((entry) =>
		entry.endsWith(".js"),
	);

	if (bundleName === undefined)
		throw new Error(`Missing Exported Bundle: ${bundleRoot}`);

	const bundle = await readFile(join(bundleRoot, bundleName), "utf-8");
	const stylesheet = /StyleCollection\.inject\([\s\S]{0,4000}/.exec(
		bundle,
	)?.[0];

	if (stylesheet === undefined)
		throw new Error(`Missing Compiled Stylesheet: ${bundleName}`);

	for (const utility of [
		"flex-1",
		"items-center",
		"justify-center",
		"text-2xl",
	])
		expect(stylesheet, utility).toContain(utility);
}

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it("installs, builds, and typechecks TanStack Router with an oRPC Hono host", async () => {
		await withScenarioWorkspace("smoke-orpc-hono-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "orpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot, "orpc");
		});
	}, 600_000);

	it("installs, builds, and typechecks Next.js with a Hono API host", async () => {
		await withScenarioWorkspace("smoke-hono-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "sqlite",
				emailProvider: "smtp",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Hono", async () => {
		await withScenarioWorkspace("smoke-hono-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "postgresql",
				emailProvider: "resend",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs, builds, and typechecks Next.js with a Fastify API host", async () => {
		await withScenarioWorkspace("smoke-fastify-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "fastify",
				database: "sqlite",
				emailProvider: "postmark",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Fastify", async () => {
		await withScenarioWorkspace("smoke-fastify-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "fastify",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks Next.js with an Express API host", async () => {
		await withScenarioWorkspace("smoke-express-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "express",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks TanStack Router with Express", async () => {
		await withScenarioWorkspace("smoke-express-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "express",
				database: "sqlite",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectCredentialedGeneratedServer(workspace.projectRoot);
		});
	}, 600_000);

	it("installs a prisma project, generates the client, and typechecks", async () => {
		await withScenarioWorkspace("smoke-prisma", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			expect(
				await pathExists(
					join(workspace.projectRoot, "packages/db/src/generated/prisma"),
				),
			).toBe(true);

			await expectInstallAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs and typechecks a drizzle project with trpc and tailwind", async () => {
		await withScenarioWorkspace("smoke-drizzle", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "postgresql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectInstallAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs and typechecks a drizzle mysql project", async () => {
		await withScenarioWorkspace("smoke-drizzle-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "mysql",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectInstallAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs and typechecks a drizzle sqlite project", async () => {
		await withScenarioWorkspace("smoke-drizzle-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					authentication: "better-auth",
					database: "sqlite",
					linter: "biome",
					orm: "drizzle",
					packageManager: "pnpm",
					rpc: "trpc",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectInstallAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	for (const cell of postgresProviderCells) {
		const transactionTitle = {
			supported: "runs a transaction probe",
			unsupported: "confirms the known transaction limitation",
		}[cell.transaction];

		it(`installs, typechecks, and ${transactionTitle} on drizzle with ${cell.provider} postgres`, async () => {
			await withScenarioWorkspace(
				`smoke-drizzle-${cell.provider}`,
				async (workspace) => {
					const url = smokeDatabaseUrl();

					await createProject(
						workspace,
						{
							authentication: "better-auth",
							database: "postgresql",
							databaseProvider: cell.provider,
							linter: "biome",
							orm: "drizzle",
							packageManager: "pnpm",
							rpc: "trpc",
							style: "tailwind",
							web: "nextjs",
						},
						{ install: true },
					);

					await writeFile(
						join(workspace.projectRoot, "packages/db/src/transaction-probe.ts"),
						transactionProbeSource,
					);

					await expectInstallAndTypecheck(workspace, "pnpm");

					const probe = await runTransactionProbe(workspace, url);
					switch (cell.transaction) {
						case "supported":
							expect(probe.exitCode, `${probe.stdout}\n${probe.stderr}`).toBe(
								0,
							);

							break;

						case "unsupported":
							expect(probe.exitCode, probe.stderr).not.toBe(0);
							expect(probe.stderr).toContain(
								"No transactions support in neon-http driver",
							);

							break;
					}
				},
			);
		}, 600_000);
	}

	// Each framework addition gets one pnpm-only acceptance case; the
	// package-manager matrix remains Next.js-only to keep smoke cost bounded.
	it("installs, builds, and typechecks an Expo project", async () => {
		await withScenarioWorkspace("smoke-expo", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "sqlite",
				mobile: "expo",
				nativeStyleFramework: "nativewind",
				orm: "drizzle",
				packageManager: "pnpm",
				platforms: ["web", "mobile"],
				rpc: "trpc",
				style: "tailwind",
				web: "nextjs",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			expect(
				await pathExists(join(workspace.projectRoot, "apps/mobile/forge.json")),
			).toBe(true);

			await expectBundledNativeWindStyles(workspace);
		});
	}, 600_000);

	it("installs, builds, and typechecks a full TanStack Start project", async () => {
		await withScenarioWorkspace("smoke-tanstack-start", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "tanstack-start",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);

	it("installs, builds, and typechecks a TanStack Router SPA with a worker", async () => {
		await withScenarioWorkspace("smoke-tanstack-router", async (workspace) => {
			await createProject(workspace, {
				addons: ["worker"],
				linter: "biome",
				packageManager: "pnpm",
				style: "tailwind",
				web: "tanstack-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectDrainingWorker(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, builds, and typechecks a full React Router project", async () => {
		await withScenarioWorkspace("smoke-react-router", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				database: "postgresql",
				linter: "biome",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "trpc",
				style: "tailwind",
				web: "react-router",
			});

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
		});
	}, 600_000);
});
