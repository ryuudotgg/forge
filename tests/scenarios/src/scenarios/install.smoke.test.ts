import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createProject,
	expectInstallAndTypecheck,
	expectInstallBuildAndTypecheck,
	pathExists,
	runCommand,
	withScenarioWorkspace,
} from "../utils/harness";

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

async function expectCredentialedGeneratedServer(projectRoot: string) {
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

		const actual = await fetch(`${serverOrigin}/api/trpc/health?input=%7B%7D`, {
			headers: { Origin: origin, "x-trpc-source": "smoke" },
		});
		expect(actual.status).toBe(200);
		expect(actual.headers.get("access-control-allow-origin")).toBe(origin);
		expect(actual.headers.get("access-control-allow-credentials")).toBe("true");

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
		expect(await authSession.json()).toMatchObject({ user: { email } });
	} finally {
		if (server.exitCode === null) server.kill("SIGTERM");
		await exited;
	}
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
	} finally {
		if (worker.exitCode === null) worker.kill("SIGTERM");
	}

	expect(await exited, output).toBe(0);
}

describe.runIf(process.env.FORGE_SMOKE === "1")("install smoke", () => {
	it("installs, builds, and typechecks Next.js with a Hono API host", async () => {
		await withScenarioWorkspace("smoke-hono-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
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

	it("installs, builds, and typechecks TanStack Router with Hono", async () => {
		await withScenarioWorkspace("smoke-hono-spa", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				backend: "hono",
				database: "postgresql",
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

	// Each framework addition gets one pnpm-only acceptance case; the
	// package-manager matrix remains Next.js-only to keep smoke cost bounded.
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
