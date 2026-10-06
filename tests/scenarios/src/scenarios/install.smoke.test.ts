import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { createContext, Script } from "node:vm";
import { ManifestSchema } from "@ryuugg/core";
import { Schema } from "effect";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { expectEmailAuth } from "../utils/email-auth";
import {
	createProject,
	expectInstallAndBuild,
	expectInstallAndTypecheck,
	expectInstallBuildAndTypecheck,
	type ForgeCommandResult,
	forgeEnvironment,
	pathExists,
	readJson,
	runCommand,
	runForge,
	type ScenarioProject,
	withScenarioWorkspace,
} from "../utils/harness";
import { expectFreshLinterCheck } from "../utils/linter";
import { expectPasskeyCeremony } from "../utils/passkey";

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

type WebApp = {
	root: string;
	framework: string;
	port: number;
	primary: boolean;
};

function unknownArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

async function webAppsOf(projectRoot: string): Promise<WebApp[]> {
	const manifest = Schema.decodeUnknownSync(ManifestSchema)(
		await readJson<unknown>(join(projectRoot, ".forge/manifest.json")),
	);

	const generatedEnv = await readGeneratedEnv(projectRoot);
	const secondaryApps = manifest.config.webApps;
	const apps: WebApp[] = [];
	for (const module of Object.values(manifest.modules)) {
		const root = module.root;
		if (root === undefined) continue;

		const metadataPath = join(projectRoot, root, "forge.json");
		if (!(await pathExists(metadataPath))) continue;

		const metadata = await readJson<unknown>(metadataPath);
		const framework = stringField(metadata, "framework");
		if (
			framework === undefined ||
			!["nextjs", "react-router", "tanstack-router", "tanstack-start"].includes(
				framework,
			)
		)
			continue;

		const primary =
			stringField(metadata, "role") === "primary" || root === "apps/web";

		let port: unknown;
		if (primary && generatedEnv.WEB_URL !== undefined) {
			const originPort = new URL(generatedEnv.WEB_URL).port;
			if (originPort !== "") port = Number(originPort);
		} else if (!primary && unknownArray(secondaryApps)) {
			const secondary = secondaryApps.find(
				(app) => stringField(app, "name") === basename(root),
			);

			if (typeof secondary === "object" && secondary !== null)
				port = Reflect.get(secondary, "port");
		}

		if (
			typeof port !== "number" ||
			!Number.isInteger(port) ||
			port < 1 ||
			port > 65535
		)
			throw new Error(`Missing Web App Port: ${root}`);

		apps.push({ root, framework, port, primary });
	}

	return apps;
}

const authPluginConfig = {
	authMethods: ["email-password", "google", "passkey"],
	authPlugins: ["two-factor", "username", "admin", "organization"],
};

function smokeMysqlUrl() {
	const url = process.env.FORGE_SMOKE_MYSQL_URL;
	if (url === undefined)
		throw new Error("Missing Smoke Database: FORGE_SMOKE_MYSQL_URL");

	return url;
}

function smokeDatabaseOn(serverUrl: string, name: string) {
	const url = new URL(serverUrl);
	url.pathname = `/${name}`;
	return url.toString();
}

const createDatabaseScripts = {
	postgresql: (name: string) =>
		[
			'import pg from "pg";',
			`const client = new pg.Client({ connectionString: ${JSON.stringify(smokeDatabaseUrl())} });`,
			"await client.connect();",
			`await client.query(${JSON.stringify(`DROP DATABASE IF EXISTS "${name}"`)});`,
			`await client.query(${JSON.stringify(`CREATE DATABASE "${name}"`)});`,
			"await client.end();",
		].join("\n"),
	mysql: (name: string) =>
		[
			'import mysql from "mysql2/promise";',
			`const connection = await mysql.createConnection(${JSON.stringify(smokeMysqlUrl())});`,
			`await connection.query(${JSON.stringify(`DROP DATABASE IF EXISTS \`${name}\``)});`,
			`await connection.query(${JSON.stringify(`CREATE DATABASE \`${name}\``)});`,
			"await connection.end();",
		].join("\n"),
};

async function createSmokeDatabase(
	projectRoot: string,
	dialect: keyof typeof createDatabaseScripts,
	name: string,
) {
	const result = await runCommand(
		"node",
		["--input-type=module", "-e", createDatabaseScripts[dialect](name)],
		{ cwd: join(projectRoot, "packages/db") },
	);

	expect(
		result.exitCode,
		`creating database ${name} failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
	).toBe(0);
}

async function expectSchemaPush(projectRoot: string, env?: NodeJS.ProcessEnv) {
	const push = await runCommand("pnpm", ["db:push"], {
		cwd: join(projectRoot, "apps/web"),
		env,
	});

	expect(
		push.exitCode,
		`pnpm db:push failed with code ${push.exitCode}\n${push.stdout}\n${push.stderr}`,
	).toBe(0);
}

async function expectPasskeyInstallAndTypecheck(workspace: ScenarioProject) {
	await writeFile(
		join(workspace.projectRoot, "packages/auth/src/passkey-probe.ts"),
		[
			'import type { PasskeyOptions } from "@better-auth/passkey";',
			'import { authClient } from "./client";',
			"",
			"export const signIn = authClient.signIn.passkey;",
			"export const register = authClient.passkey.addPasskey;",
			"export const enableTwoFactor = authClient.twoFactor.enable;",
			"export const createOrganization = authClient.organization.create;",
			"export const inviteMember = authClient.organization.inviteMember;",
			"export const options = {",
			"  registration: { extensions: () => ({ credProps: true, prf: {} }) },",
			"  authentication: { extensions: () => ({ credProps: true, prf: {} }) },",
			"} satisfies PasskeyOptions;",
			"",
		].join("\n"),
	);

	await expectInstallAndTypecheck(workspace, "pnpm");
}

function postgresDatabaseEnv(name: string): NodeJS.ProcessEnv {
	const url = smokeDatabaseOn(smokeDatabaseUrl(), name);
	return { DATABASE_URL: url, DATABASE_DIRECT_URL: url };
}

function mysqlDatabaseEnv(name: string): NodeJS.ProcessEnv {
	return { DATABASE_URL: smokeDatabaseOn(smokeMysqlUrl(), name) };
}

type ServerLaunch = "node" | "dev" | "start";

function scriptEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const scrubbed: NodeJS.ProcessEnv = {};
	for (const name of Object.keys(process.env))
		if (
			name === "NODE_ENV" ||
			name === "PORT" ||
			name === "CI" ||
			name === "TEST" ||
			name === "VITEST" ||
			name.startsWith("VITEST_")
		)
			scrubbed[name] = undefined;

	return { ...scrubbed, ...overrides };
}

function stopProcessGroup(pid: number, signal: NodeJS.Signals) {
	try {
		process.kill(-pid, signal);
	} catch {}
}

function processGroupAlive(pid: number) {
	try {
		process.kill(-pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function withGeneratedServer(
	projectRoot: string,
	env: NodeJS.ProcessEnv,
	serverOrigin: string,
	exercise: (output: () => string) => Promise<void>,
	host: "server" | "nextjs" = "server",
	launch: ServerLaunch = "node",
) {
	const cwd = join(projectRoot, host === "nextjs" ? "apps/web" : "apps/server");
	const ambientEnv = { ...process.env };
	delete ambientEnv.CI;

	const args =
		host === "nextjs"
			? [
					"node_modules/next/dist/bin/next",
					"start",
					"--port",
					new URL(serverOrigin).port,
				]
			: ["dist/index.js"];

	const server =
		launch === "node"
			? spawn("node", args, { cwd, env: { ...ambientEnv, ...env } })
			: spawn("pnpm", ["run", launch], {
					cwd,
					detached: true,
					env: { ...process.env, ...scriptEnvironment(env) },
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
		const attempts = launch === "node" ? 50 : 300;
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			if (server.exitCode !== null) break;

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

		await exercise(() => output);
	} finally {
		const pid = server.pid;
		if (launch === "node" || pid === undefined) {
			if (server.exitCode === null) server.kill("SIGTERM");
			await exited;
		} else {
			stopProcessGroup(pid, "SIGTERM");

			for (
				let attempt = 0;
				attempt < 50 && processGroupAlive(pid);
				attempt += 1
			)
				await new Promise((resolveWait) => setTimeout(resolveWait, 100));

			stopProcessGroup(pid, "SIGKILL");
		}
	}
}

async function expectEmailPreview(projectRoot: string) {
	const port = 3883;
	await expectPortFree(port);

	const server = spawn("pnpm", ["run", "dev"], {
		cwd: join(projectRoot, "packages/email"),
		detached: true,
		env: { ...process.env, ...scriptEnvironment({}) },
	});

	let output = "";
	const capture = (chunk: Buffer) => {
		output += chunk.toString();
	};

	server.stdout.on("data", capture);
	server.stderr.on("data", capture);
	server.on("error", (error) => {
		output += error.message;
	});

	try {
		let ready = false;
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline && server.exitCode === null) {
			try {
				const response = await fetch(`http://localhost:${port}/`, {
					signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
				});

				if (response.status === 200) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		expect(ready, output).toBe(true);

		const preview = await fetch(
			`http://localhost:${port}/preview/verification-code`,
			{ signal: AbortSignal.timeout(120_000) },
		);

		expect(preview.status, output).toBe(200);
		expect(await preview.text(), output).toContain("123456");
	} finally {
		const pid = server.pid;
		if (pid !== undefined) {
			stopProcessGroup(pid, "SIGTERM");

			for (
				let attempt = 0;
				attempt < 50 && processGroupAlive(pid);
				attempt += 1
			)
				await new Promise((resolveWait) => setTimeout(resolveWait, 100));

			stopProcessGroup(pid, "SIGKILL");
		}
	}
}

async function expectCredentialedGeneratedServer(
	projectRoot: string,
	options?: {
		readonly apiOrigin?: string;
		readonly clientOrigin?: string;
		readonly emailAuth?: boolean;
		readonly host?: "server" | "nextjs";
		readonly launch?: ServerLaunch;
		readonly passkey?: boolean;
		readonly polar?: boolean;
		readonly rpc?: "trpc" | "orpc";
		readonly username?: string;
		readonly webOrigin?: string;
	},
) {
	const rpc = options?.rpc ?? "trpc";
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const origin = options?.clientOrigin ?? generatedEnv.WEB_URL;
	const serverOrigin = generatedEnv.APP_ORIGIN;
	const credentials = options?.host === "nextjs" ? "include" : undefined;

	if (origin === undefined || serverOrigin === undefined)
		throw new Error(`Missing Generated Origins: ${projectRoot}`);

	if (options?.host === "nextjs") {
		expect(serverOrigin).toBe("http://localhost:3000");
		expect(generatedEnv.WEB_URLS?.split(",")).toContain(origin);
	} else {
		expect(generatedEnv.WEB_URL).toBe(
			options?.webOrigin ?? "http://localhost:3000",
		);

		expect(serverOrigin).toBe(options?.apiOrigin ?? "http://localhost:3001");
	}

	if (options?.polar) {
		expect(generatedEnv.POLAR_ACCESS_TOKEN).toBe("");
		expect(generatedEnv.POLAR_WEBHOOK_SECRET).toBe("");
		expect(generatedEnv.POLAR_SERVER).toBe("sandbox");
	}

	await expectSchemaPush(projectRoot);

	await withGeneratedServer(
		projectRoot,
		generatedEnv,
		serverOrigin,
		async (output) => {
			if (rpc === "trpc") {
				const preflight = await fetch(`${serverOrigin}/api/trpc/health`, {
					credentials,
					method: "OPTIONS",
					headers: {
						Origin: origin,
						"Access-Control-Request-Headers": "x-trpc-source,trpc-accept",
						"Access-Control-Request-Method": "GET",
					},
				});

				expect(preflight.status).toBe(204);
				expect(preflight.headers.get("access-control-allow-origin")).toBe(
					origin,
				);

				expect(preflight.headers.get("access-control-allow-credentials")).toBe(
					"true",
				);

				expect(preflight.headers.get("access-control-allow-headers")).toContain(
					"x-trpc-source",
				);

				expect(preflight.headers.get("access-control-allow-headers")).toContain(
					"trpc-accept",
				);

				const actual = await fetch(
					`${serverOrigin}/api/trpc/health?input=%7B%7D`,
					{
						credentials,
						headers: {
							Origin: origin,
							"x-trpc-source": "smoke",
							...(options?.host === "nextjs"
								? { "trpc-accept": "application/json" }
								: {}),
						},
					},
				);

				expect(actual.status).toBe(200);
				expect(actual.headers.get("access-control-allow-origin")).toBe(origin);
				expect(actual.headers.get("access-control-allow-credentials")).toBe(
					"true",
				);

				if (options?.host === "nextjs")
					expect(await actual.json()).toMatchObject({
						result: { data: { json: { status: "ok" } } },
					});
			}

			const email = "hono-smoke@example.com";
			const signup = await fetch(`${serverOrigin}/api/auth/sign-up/email`, {
				credentials,
				body: JSON.stringify({
					email,
					name: "Hono Smoke",
					password: "forge-smoke-password",
					...(options?.username ? { username: options.username } : {}),
				}),
				headers: { "Content-Type": "application/json", Origin: origin },
				method: "POST",
			});

			const signupBody = await signup.text();
			expect(signup.status, `${signupBody}\n${output()}`).toBe(200);
			expect(signup.headers.get("access-control-allow-origin")).toBe(origin);
			expect(signup.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);

			const setCookie = signup.headers.get("set-cookie");
			expect(setCookie).toBeTruthy();

			if (setCookie === null)
				throw new Error("Missing Session Cookie: Better Auth sign-up");

			const cookie = setCookie.split(";", 1)[0];
			if (cookie === undefined)
				throw new Error("Missing Cookie Value: Better Auth sign-up");

			if (options?.passkey)
				await expectPasskeyCeremony(serverOrigin, origin, cookie, output);

			if (options?.emailAuth)
				await expectEmailAuth(serverOrigin, origin, output);

			if (options?.polar) {
				const checkout = await fetch(`${serverOrigin}/api/auth/checkout`, {
					body: JSON.stringify({ products: ["forge-smoke"] }),
					headers: {
						Cookie: cookie,
						Origin: origin,
						"Content-Type": "application/json",
					},
					method: "POST",
				});

				expect(checkout.status, `${await checkout.text()}\n${output()}`).toBe(
					503,
				);

				const customerState = await fetch(
					`${serverOrigin}/api/auth/customer/state`,
					{ headers: { Cookie: cookie, Origin: origin } },
				);

				expect(
					customerState.status,
					`${await customerState.text()}\n${output()}`,
				).toBe(503);

				const webhook = await fetch(`${serverOrigin}/api/auth/polar/webhooks`, {
					body: JSON.stringify({
						type: "forge.smoke",
						data: { message: "original" },
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				});

				expect(webhook.status, `${await webhook.text()}\n${output()}`).toBe(
					503,
				);
			}

			const authSession = await fetch(`${serverOrigin}/api/auth/get-session`, {
				credentials,
				headers: { Cookie: cookie, Origin: origin },
			});

			expect(authSession.status).toBe(200);
			expect(authSession.headers.get("access-control-allow-origin")).toBe(
				origin,
			);

			expect(authSession.headers.get("access-control-allow-credentials")).toBe(
				"true",
			);

			const username = options?.username;
			const session: unknown = await authSession.json();
			expect(session).toMatchObject({
				user:
					username === undefined
						? { email }
						: { email, role: "user", username },
			});

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

			if (username === undefined) return;

			const usernameSignIn = await fetch(
				`${serverOrigin}/api/auth/sign-in/username`,
				{
					body: JSON.stringify({ password: "forge-smoke-password", username }),
					headers: { "Content-Type": "application/json", Origin: origin },
					method: "POST",
				},
			);

			const usernameSignInBody = await usernameSignIn.text();
			expect(usernameSignIn.status, `${usernameSignInBody}\n${output()}`).toBe(
				200,
			);
		},
		options?.host,
		options?.launch,
	);

	if (!options?.polar) return;

	const secret = "forge-smoke-webhook-secret";
	await withGeneratedServer(
		projectRoot,
		{ ...generatedEnv, POLAR_WEBHOOK_SECRET: secret },
		serverOrigin,
		async (output) => {
			const body = JSON.stringify(
				{ type: "forge.smoke", data: { message: "original" } },
				null,
				2,
			);

			const checkout = await fetch(`${serverOrigin}/api/auth/checkout`, {
				body: JSON.stringify({ products: ["forge-smoke"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});

			expect(checkout.status, `${await checkout.text()}\n${output()}`).toBe(
				503,
			);

			const webhookId = randomUUID();
			const timestamp = Math.floor(Date.now() / 1000).toString();
			const signature = createHmac("sha256", Buffer.from(secret, "utf8"))
				.update(`${webhookId}.${timestamp}.${body}`)
				.digest("base64");

			const headers = {
				"Content-Type": "application/json",
				"webhook-id": webhookId,
				"webhook-timestamp": timestamp,
				"webhook-signature": `v1,${signature}`,
			};

			const webhook = await fetch(`${serverOrigin}/api/auth/polar/webhooks`, {
				body,
				headers,
				method: "POST",
			});

			expect(webhook.status, `${await webhook.text()}\n${output()}`).toBe(200);

			const tampered = await fetch(`${serverOrigin}/api/auth/polar/webhooks`, {
				body: body.replace("original", "tampered"),
				headers,
				method: "POST",
			});

			expect(tampered.status, `${await tampered.text()}\n${output()}`).toBe(
				403,
			);
		},
	);

	await withGeneratedServer(
		projectRoot,
		{ ...generatedEnv, POLAR_ACCESS_TOKEN: "forge-smoke-token" },
		serverOrigin,
		async (output) => {
			const checkout = await fetch(`${serverOrigin}/api/auth/checkout`, {
				body: JSON.stringify({ products: ["forge-smoke"] }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			});

			expect(checkout.status, `${await checkout.text()}\n${output()}`).toBe(
				401,
			);
		},
	);
}

async function expectUnrelatedOrpcRequests(projectRoot: string) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const serverOrigin = generatedEnv.APP_ORIGIN;
	if (serverOrigin === undefined)
		throw new Error(`Missing Generated Origin: ${projectRoot}`);

	await withGeneratedServer(
		projectRoot,
		generatedEnv,
		serverOrigin,
		async () => {
			const headers = { "x-context-probe": "fail", "x-csrf-token": "probe" };
			for (const path of ["/missing", "/api/orpc-other/health", "/api/orpc"]) {
				const response = await fetch(`${serverOrigin}${path}`, { headers });
				expect(response.status, path).toBe(404);
			}

			const response = await fetch(`${serverOrigin}/api/orpc/health`, {
				headers,
			});

			expect(response.status).toBe(500);
		},
	);
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

async function expectSameOriginOrpcSession(
	origin: string,
	cookie: string,
	userId: string,
) {
	const headers = {
		Origin: origin,
		"Content-Type": "application/json",
		"x-csrf-token": "orpc",
	};

	const authenticated = await fetch(`${origin}/api/orpc/me`, {
		method: "POST",
		headers: { ...headers, Cookie: cookie },
		body: JSON.stringify({ json: null }),
	});

	expect(authenticated.status).toBe(200);
	expect(await authenticated.json()).toEqual({ json: { id: userId } });

	const anonymous = await fetch(`${origin}/api/orpc/me`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: null }),
	});

	const forged = await fetch(`${origin}/api/orpc/me`, {
		method: "POST",
		headers: {
			Origin: origin,
			"Content-Type": "application/json",
			Cookie: cookie,
		},
		body: JSON.stringify({ json: null }),
	});

	const missing = await fetch(`${origin}/api/orpc/missing`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: null }),
	});

	expect(anonymous.status).toBe(401);
	expect(forged.status).toBe(403);
	expect(missing.status).toBe(404);

	const caller = await fetch(`${origin}/api/caller-probe`, {
		headers: { Cookie: cookie },
	});

	const anonymousCaller = await fetch(`${origin}/api/caller-probe`);

	expect(caller.status).toBe(200);
	expect(await caller.json()).toEqual({
		health: { status: "ok" },
		me: { id: userId },
	});

	expect(anonymousCaller.status).toBe(401);
}

async function expectBundledOrpcClient(
	projectRoot: string,
	sourceRoot: string,
	origin: string,
	cookie: string,
	userId: string,
) {
	const webRoot = join(projectRoot, "apps/web");

	await writeFile(
		join(webRoot, "orpc-probe.ts"),
		(sourceRoot === ""
			? generatedOrpcHydrationProbe
			: generatedOrpcClientProbe
		).replace("__CLIENT_IMPORT__", `./${sourceRoot}/orpc/client`),
	);

	const hydrationState =
		sourceRoot === ""
			? await fetch(`${origin}/api/hydration-probe`).then((response) => {
					expect(response.status).toBe(200);
					return response.json();
				})
			: undefined;

	const result = await build({
		configFile: false,
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		root: webRoot,
		logLevel: "error",
		build: {
			minify: false,
			write: false,
			lib: {
				entry: join(webRoot, "orpc-probe.ts"),
				name: "OrpcProbe",
				formats: ["iife"],
			},
		},
	});

	const outputs = Array.isArray(result) ? result : [result];
	const bundle = outputs
		.flatMap((output) => ("output" in output ? output.output : []))
		.find((output) => output.type === "chunk" && output.isEntry);

	if (bundle?.type !== "chunk")
		throw new Error("Missing Browser Client Bundle");

	const probe = (sessionCookie: string) =>
		new Promise<unknown>((resolveResult, rejectResult) => {
			const context = createContext({
				AbortController,
				AbortSignal,
				Blob,
				DOMException,
				File,
				FormData,
				Headers,
				ReadableStream,
				Request,
				Response,
				TextDecoder,
				TextEncoder,
				TransformStream,
				URL,
				URLSearchParams,
				WritableStream,
				atob,
				btoa,
				clearTimeout,
				console,
				crypto,
				dehydratedState: hydrationState,
				location: { origin },
				setTimeout,
				reportResult: resolveResult,
				reportError: rejectResult,
				fetch: (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
					const request = new Request(input, init);
					if (sourceRoot === "")
						expect(new URL(request.url).pathname).not.toBe("/api/orpc/health");

					expect(request.credentials).toBe("include");
					expect(new URL(request.url).origin).toBe(origin);
					request.headers.set("Origin", origin);
					if (sessionCookie) request.headers.set("Cookie", sessionCookie);

					return fetch(request);
				},
			});

			new Script(
				"globalThis.window = globalThis; globalThis.self = globalThis;",
			).runInContext(context);

			new Script(bundle.code).runInContext(context, { timeout: 5000 });
		});

	expect(await probe(cookie)).toEqual({
		health: { status: "ok" },
		me: { value: { id: userId } },
	});

	expect(await probe("")).toEqual({
		health: { status: "ok" },
		me: { status: 401 },
	});
}

async function signUpSession(
	origin: string,
	requestOrigin: string,
	email: string,
	output: () => string,
) {
	const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { Origin: requestOrigin, "Content-Type": "application/json" },
		body: JSON.stringify({
			email,
			name: "Self Hosted",
			password: "forge-smoke-password",
		}),
	});

	expect(signup.status, `${await signup.text()}\n${output()}`).toBe(200);

	const cookie = signup.headers.get("set-cookie")?.split(";", 1)[0];
	if (cookie === undefined)
		throw new Error("Missing Session Cookie: Better Auth sign-up");

	const sessionResponse = await fetch(`${origin}/api/auth/get-session`, {
		headers: { Cookie: cookie, Origin: requestOrigin },
	});

	const session: unknown = await sessionResponse.json();

	expect(sessionResponse.status).toBe(200);

	if (requestOrigin !== origin)
		expect(sessionResponse.headers.get("access-control-allow-origin")).toBe(
			requestOrigin,
		);

	if (
		typeof session !== "object" ||
		session === null ||
		!("user" in session) ||
		typeof session.user !== "object" ||
		session.user === null ||
		!("id" in session.user) ||
		typeof session.user.id !== "string"
	)
		throw new Error("Missing Session User: Better Auth sign-up");

	return { cookie, userId: session.user.id };
}

async function expectOrpcLoaderRoute(
	origin: string,
	sessions: ReadonlyArray<{ readonly cookie: string; readonly userId: string }>,
	output: () => string,
) {
	const render = async (cookie?: string) => {
		const page = await fetch(`${origin}/orpc-example`, {
			headers: cookie === undefined ? {} : { Cookie: cookie },
		});

		const html = await page.text();
		expect(page.status, output()).toBe(200);
		return /data-testid="orpc-me">([^<]*)</.exec(html)?.[1];
	};

	const rendered = await Promise.all([
		...sessions.map((session) => render(session.cookie)),
		render(),
	]);

	expect(rendered).toEqual([
		...sessions.map((session) => session.userId),
		"Signed out",
	]);
}

async function bundleText(root: string) {
	const files = await readdir(root, { recursive: true, withFileTypes: true });
	const contents = await Promise.all(
		files
			.filter((file) => file.isFile() && file.name.endsWith(".js"))
			.map((file) => readFile(join(file.parentPath, file.name), "utf8")),
	);

	return contents.join("\n");
}

async function expectServerOnlyCodeOutOfClientBundle(projectRoot: string) {
	const dist = join(projectRoot, "apps/web/dist");
	const client = await bundleText(join(dist, "client"));
	const server = await bundleText(join(dist, "server"));
	for (const marker of ["AUTH_SECRET", "DATABASE_URL", "@libsql"]) {
		expect(server, marker).toContain(marker);
		expect(client, marker).not.toContain(marker);
	}
}

async function expectBrowserOrpcClientBundle(projectRoot: string) {
	const client = await bundleText(join(projectRoot, "apps/web/dist/client"));
	for (const pattern of [
		/\/api\/orpc/,
		/["'`]x-csrf-token["'`]/,
		/credentials:\s*["'`]include["'`]/,
	])
		expect(pattern.test(client), String(pattern)).toBe(true);

	expect(/\/api\/trpc/.test(client)).toBe(false);
}

async function expectPortFree(port: number) {
	const probe = createServer();

	await new Promise<void>((resolveListen, rejectListen) => {
		probe.once("error", (error) =>
			rejectListen(new Error(`Port In Use: ${port}`, { cause: error })),
		);

		probe.listen(port, resolveListen);
	});

	await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
}

async function reservePort() {
	const reservation = createServer();

	await new Promise<void>((resolveListen, rejectListen) => {
		reservation.once("error", rejectListen);
		reservation.listen(0, "127.0.0.1", resolveListen);
	});

	const address = reservation.address();
	if (address === null || typeof address === "string")
		throw new Error("Missing Reserved Port");

	await new Promise<void>((resolveClose, rejectClose) => {
		reservation.close((error) => (error ? rejectClose(error) : resolveClose()));
	});

	return address.port;
}

const rpcHealthRequests = {
	orpc: {
		path: "/api/orpc/health",
		method: "POST",
		headers: { "Content-Type": "application/json", "x-csrf-token": "orpc" },
		body: JSON.stringify({ json: null }),
		result: { json: { status: "ok" } },
	},
	trpc: {
		path: "/api/trpc/health",
		method: "GET",
		headers: { "x-trpc-source": "smoke" },
		body: undefined,
		result: { result: { data: { json: { status: "ok" } } } },
	},
} as const;

function rpcHealthInit(
	health: (typeof rpcHealthRequests)[keyof typeof rpcHealthRequests],
	headers: Readonly<Record<string, string>> = {},
): RequestInit {
	return {
		method: health.method,
		headers: { ...health.headers, ...headers },
		body: health.body,
	};
}

type SelfHostWeb = "nextjs" | "react-router" | "tanstack-start";

const selfHostSourceRoots = {
	nextjs: "",
	"react-router": "app",
	"tanstack-start": "src",
} as const satisfies Record<SelfHostWeb, string>;

function launchedServer(
	child: ChildProcessWithoutNullStreams,
	origin: string,
	kill: () => Promise<void>,
) {
	let output = "";
	const capture = (chunk: Buffer) => {
		output += chunk.toString();
	};

	child.stdout.on("data", capture);
	child.stderr.on("data", capture);

	let failure: Error | undefined;
	const exited = new Promise<void>((resolveExit) => {
		child.once("exit", () => resolveExit());
		child.once("error", (error) => {
			failure = error;
			resolveExit();
		});
	});

	return {
		child,
		origin,
		failure: () => failure,
		output: () => output,
		stop: async () => {
			await kill();
			await exited;
		},
	};
}

async function startSelfHostedServer(
	projectRoot: string,
	web: SelfHostWeb,
	injectPort: boolean,
) {
	const webRoot = join(projectRoot, "apps/web");
	const generatedEnv = await readGeneratedEnv(projectRoot);
	if (web === "nextjs") {
		const port = await reservePort();
		const origin = `http://127.0.0.1:${port}`;
		const env = { ...generatedEnv, APP_ORIGIN: origin, WEB_URL: origin };
		const ambientEnv = { ...process.env };

		delete ambientEnv.CI;

		await expectSchemaPush(projectRoot, env);

		const child = spawn(
			"node",
			[
				join(webRoot, "node_modules/next/dist/bin/next"),
				"start",
				"--hostname",
				"127.0.0.1",
				"--port",
				String(port),
			],
			{ cwd: webRoot, env: { ...ambientEnv, ...env } },
		);

		return launchedServer(child, origin, async () => {
			if (child.exitCode === null) child.kill("SIGTERM");
		});
	}

	const injectedPort = injectPort ? await reservePort() : undefined;
	const origin =
		injectedPort === undefined
			? generatedEnv.APP_ORIGIN
			: `http://127.0.0.1:${injectedPort}`;

	if (origin === undefined)
		throw new Error(`Missing Generated Origin: ${projectRoot}`);

	await expectPortFree(Number(new URL(origin).port));
	await expectSchemaPush(projectRoot);

	const child = spawn("pnpm", ["run", "start"], {
		cwd: webRoot,
		detached: true,
		env: {
			...process.env,
			...scriptEnvironment(
				injectedPort === undefined
					? {}
					: { APP_ORIGIN: origin, PORT: String(injectedPort) },
			),
		},
	});

	return launchedServer(child, origin, async () => {
		const pid = child.pid;
		if (pid === undefined) return;

		stopProcessGroup(pid, "SIGTERM");

		for (let attempt = 0; attempt < 50 && processGroupAlive(pid); attempt += 1)
			await new Promise((resolveWait) => setTimeout(resolveWait, 100));

		stopProcessGroup(pid, "SIGKILL");
	});
}

async function withWebApp(
	projectRoot: string,
	app: WebApp,
	exercise: (output: () => string) => Promise<void>,
) {
	const cwd = join(projectRoot, app.root);
	const packageJson = await readJson<unknown>(join(cwd, "package.json"));
	const scripts: unknown =
		typeof packageJson === "object" && packageJson !== null
			? Reflect.get(packageJson, "scripts")
			: undefined;

	const args =
		stringField(scripts, "start") !== undefined
			? ["run", "start"]
			: ["run", "preview", "--port", String(app.port), "--strictPort"];

	await expectPortFree(app.port);

	const child = spawn("pnpm", args, {
		cwd,
		detached: true,
		env: { ...process.env, ...scriptEnvironment({}) },
	});

	const server = launchedServer(
		child,
		`http://localhost:${app.port}`,
		async () => {
			const pid = child.pid;
			if (pid === undefined) return;

			stopProcessGroup(pid, "SIGTERM");

			for (
				let attempt = 0;
				attempt < 50 && processGroupAlive(pid);
				attempt += 1
			)
				await new Promise((resolveWait) => setTimeout(resolveWait, 100));

			stopProcessGroup(pid, "SIGKILL");
		},
	);

	try {
		let ready = false;
		for (let attempt = 0; attempt < 300; attempt += 1) {
			if (child.exitCode !== null || server.failure() !== undefined) break;

			try {
				const response = await fetch(`${server.origin}/`);
				if (response.status === 200) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		expect(ready, server.output()).toBe(true);

		await exercise(server.output);
	} finally {
		await server.stop();
	}
}

async function expectSelfHostedRpc(
	projectRoot: string,
	options: {
		readonly web: SelfHostWeb;
		readonly rpc: "trpc" | "orpc";
		readonly clientOrigin?: string;
		readonly injectPort?: boolean;
	},
) {
	const { web, rpc, clientOrigin } = options;
	const health = rpcHealthRequests[rpc];
	const server = await startSelfHostedServer(
		projectRoot,
		web,
		options.injectPort === true,
	);

	const { origin, output } = server;
	try {
		let ready = false;
		for (let attempt = 0; attempt < 300; attempt += 1) {
			if (server.child.exitCode !== null || server.failure() !== undefined)
				break;

			try {
				const response = await fetch(
					`${origin}${health.path}`,
					rpcHealthInit(health),
				);

				if (response.ok) {
					ready = true;
					break;
				}
			} catch {}

			await new Promise((resolveWait) => setTimeout(resolveWait, 100));
		}

		const failure = server.failure();
		if (failure !== undefined) throw failure;

		expect(ready, output()).toBe(true);

		const healthResponse = await fetch(
			`${origin}${health.path}`,
			rpcHealthInit(health),
		);

		expect(await healthResponse.json()).toEqual(health.result);

		if (web === "nextjs") {
			const page = await fetch(`${origin}/orpc-example`);
			const html = await page.text();

			expect(page.status, output()).toBe(200);
			expect(html).toMatch(/data-testid="orpc-health"[^>]*>ok<\/p>/);
		}

		if (clientOrigin !== undefined) {
			for (const path of [health.path, "/api/auth/get-session"]) {
				const preflight = await fetch(`${origin}${path}`, {
					method: "OPTIONS",
					headers: {
						Origin: clientOrigin,
						"Access-Control-Request-Method": health.method,
						"Access-Control-Request-Headers": Object.keys(health.headers)
							.join(", ")
							.toLowerCase(),
					},
				});

				expect(preflight.status, output()).toBe(204);
				expect(preflight.headers.get("access-control-allow-origin")).toBe(
					clientOrigin,
				);

				expect(preflight.headers.get("access-control-allow-credentials")).toBe(
					"true",
				);
			}

			const crossOrigin = await fetch(
				`${origin}${health.path}`,
				rpcHealthInit(health, { Origin: clientOrigin }),
			);

			expect(crossOrigin.status, output()).toBe(200);
			expect(crossOrigin.headers.get("access-control-allow-origin")).toBe(
				clientOrigin,
			);
		}

		const session = await signUpSession(
			origin,
			clientOrigin ?? origin,
			"self-host@example.com",
			output,
		);

		if (web !== "nextjs")
			expect(session.cookie).toMatch(/^__Secure-better-auth\.session_token=/);

		if (rpc === "trpc") {
			const call = await fetch(
				`${origin}${health.path}`,
				rpcHealthInit(health, { Cookie: session.cookie, Origin: origin }),
			);

			expect(call.status, output()).toBe(200);
			expect(await call.json()).toEqual(health.result);
			return;
		}

		await expectSameOriginOrpcSession(origin, session.cookie, session.userId);

		if (web !== "tanstack-start") {
			await expectBundledOrpcClient(
				projectRoot,
				selfHostSourceRoots[web],
				origin,
				session.cookie,
				session.userId,
			);

			return;
		}

		const second = await signUpSession(
			origin,
			origin,
			"self-host-second@example.com",
			output,
		);

		await expectOrpcLoaderRoute(origin, [session, second], output);
		await expectServerOnlyCodeOutOfClientBundle(projectRoot);
		await expectBrowserOrpcClientBundle(projectRoot);
	} finally {
		await server.stop();
	}
}

const generatedOrpcClientProbe = `import { client } from "__CLIENT_IMPORT__";

void (async () => {
  const health = await client.health();
  const me = await client.me().then(
    (value) => ({ value }),
    (error: { status?: number }) => ({ status: error.status }),
  );

  globalThis.reportResult({ health, me });
})().catch(globalThis.reportError);
`;

const generatedOrpcHydrationProbe = `import { client, orpc } from "__CLIENT_IMPORT__";
import { hydrate, QueryClient } from "@tanstack/react-query";

void (async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30 * 1000 } } });

  hydrate(queryClient, globalThis.dehydratedState);

  const health = await queryClient.fetchQuery(orpc.health.queryOptions());
  const me = await client.me().then(
    (value) => ({ value }),
    (error: { status?: number }) => ({ status: error.status }),
  );

  globalThis.reportResult({ health, me });
})().catch(globalThis.reportError);
`;

async function expectGeneratedOrpcClient(
	projectRoot: string,
	generatedEnv: NodeJS.ProcessEnv,
	cookie: string,
	userId: string,
) {
	const webRoot = join(projectRoot, "apps/web");
	const manifest = await readJson<{ framework: string }>(
		join(webRoot, "forge.json"),
	);

	const sourceRoot =
		manifest.framework === "nextjs"
			? ""
			: manifest.framework === "react-router"
				? "app/"
				: "src/";

	await writeFile(
		join(webRoot, "orpc-probe.ts"),
		generatedOrpcClientProbe.replace(
			"__CLIENT_IMPORT__",
			`./${sourceRoot}orpc/client`,
		),
	);

	const result = await build({
		configFile: false,
		root: webRoot,
		logLevel: "error",
		define: {
			"import.meta.env.VITE_SERVER_URL": JSON.stringify(
				generatedEnv.VITE_SERVER_URL,
			),
			...(manifest.framework === "nextjs"
				? {
						"process.env": "{}",
						"process.env.NODE_ENV": '"production"',
						"process.env.NEXT_PUBLIC_SERVER_URL": JSON.stringify(
							generatedEnv.NEXT_PUBLIC_SERVER_URL,
						),
					}
				: {}),
		},
		build: {
			minify: false,
			write: false,
			lib: {
				entry: join(webRoot, "orpc-probe.ts"),
				name: "OrpcProbe",
				formats: ["iife"],
			},
		},
	});

	const outputs = Array.isArray(result) ? result : [result];
	const bundle = outputs
		.flatMap((output) => ("output" in output ? output.output : []))
		.find((output) => output.type === "chunk" && output.isEntry);

	if (bundle?.type !== "chunk")
		throw new Error("Missing Browser Client Bundle");

	const probe = (sessionCookie: string) =>
		new Promise<unknown>((resolveResult, rejectResult) => {
			const context = createContext({
				AbortController,
				AbortSignal,
				Blob,
				DOMException,
				File,
				FormData,
				Headers,
				ReadableStream,
				Request,
				Response,
				TextDecoder,
				TextEncoder,
				TransformStream,
				URL,
				URLSearchParams,
				WritableStream,
				atob,
				btoa,
				clearTimeout,
				console,
				crypto,
				setTimeout,
				reportResult: resolveResult,
				reportError: rejectResult,
				fetch: async (
					input: Parameters<typeof fetch>[0],
					init?: RequestInit,
				) => {
					const request = new Request(input, init);
					expect(request.credentials).toBe("include");
					request.headers.set("Origin", generatedEnv.WEB_URL ?? "");
					if (sessionCookie) request.headers.set("Cookie", sessionCookie);

					const response = await fetch(request);
					expect(response.headers.get("access-control-allow-origin")).toBe(
						generatedEnv.WEB_URL,
					);

					expect(response.headers.get("access-control-allow-credentials")).toBe(
						"true",
					);

					return response;
				},
			});

			new Script(
				"globalThis.window = globalThis; globalThis.self = globalThis;",
			).runInContext(context);

			new Script(bundle.code).runInContext(context, { timeout: 5000 });
		});

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

function varyIncludesOrigin(response: Response) {
	return (response.headers.get("vary") ?? "")
		.split(",")
		.some((value) => value.trim().toLowerCase() === "origin");
}

async function waitForOutput(output: () => string, text: string, from = 0) {
	for (
		let attempt = 0;
		attempt < 50 && output().indexOf(text, from) === -1;
		attempt += 1
	)
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}

function cookieHeader(response: Response, previous = "") {
	const jar = new Map(
		previous
			.split("; ")
			.filter((pair) => pair !== "")
			.map((pair) => [pair.split("=", 1)[0], pair]),
	);

	for (const line of response.headers.getSetCookie()) {
		const pair = line.split(";", 1)[0] ?? "";
		jar.set(pair.split("=", 1)[0], pair);
	}

	return [...jar.values()].join("; ");
}

async function expectProductionEmailSecrets(projectRoot: string) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const origin = generatedEnv.WEB_URL;
	const serverOrigin = generatedEnv.APP_ORIGIN;
	if (origin === undefined || serverOrigin === undefined)
		throw new Error(`Missing Generated Origins: ${projectRoot}`);

	await withGeneratedServer(
		projectRoot,
		{},
		serverOrigin,
		async (output) => {
			const headers = { "Content-Type": "application/json", Origin: origin };
			const signup = await fetch(`${serverOrigin}/api/auth/sign-up/email`, {
				body: JSON.stringify({
					email: "prod-signup@example.com",
					name: "Production Smoke",
					password: "forge-smoke-password",
				}),
				headers,
				method: "POST",
			});

			expect(signup.status, `${await signup.text()}\n${output()}`).toBe(200);

			const cookies = signup.headers.getSetCookie();
			const sessionCookie = cookies.find((cookie) =>
				cookie.startsWith("__Secure-better-auth.session_token="),
			);

			expect(sessionCookie, cookies.join("\n")).toMatch(/;\s*Secure(;|$)/i);

			const otp = await fetch(
				`${serverOrigin}/api/auth/email-otp/send-verification-otp`,
				{
					body: JSON.stringify({
						email: "prod-smoke@example.com",
						type: "sign-in",
					}),
					headers,
					method: "POST",
				},
			);

			expect(otp.status, `${await otp.text()}\n${output()}`).toBe(200);

			const unconfigured = "Email isn't configured.";
			await waitForOutput(output, unconfigured);
			expect(output(), "the OTP send never reached sendEmail").toContain(
				unconfigured,
			);

			const beforeMagicLink = output().length;
			const magicLink = await fetch(
				`${serverOrigin}/api/auth/sign-in/magic-link`,
				{
					body: JSON.stringify({
						email: "prod-smoke@example.com",
						callbackURL: origin,
					}),
					headers,
					method: "POST",
				},
			);

			const magicLinkBody = await magicLink.text();
			expect(
				magicLink.ok,
				`magic link answered ${magicLink.status}: ${magicLinkBody}\n${output()}`,
			).toBe(false);

			await waitForOutput(output, unconfigured, beforeMagicLink);
			await new Promise((resolveWait) => setTimeout(resolveWait, 1000));

			const log = output();
			expect(
				log.indexOf(unconfigured, beforeMagicLink),
				`the magic link send never reached sendEmail: ${magicLinkBody}\n${log}`,
			).not.toBe(-1);

			expect(log).not.toContain("prod-smoke@example.com");
			expect(log).not.toContain("magic-link/verify?token=");
			expect(log).not.toMatch(/code is \d{6}/);
		},
		"server",
		"start",
	);
}

async function expectCorsPolicy(
	serverOrigin: string,
	paths: ReadonlyArray<string>,
	allowed: ReadonlyArray<string>,
	refused: ReadonlyArray<string>,
) {
	for (const origin of [...allowed, ...refused]) {
		const isAllowed = allowed.includes(origin);
		for (const path of paths) {
			const label = `${path} from ${origin}`;
			const preflight = await fetch(`${serverOrigin}${path}`, {
				headers: {
					Origin: origin,
					"Access-Control-Request-Headers": "content-type",
					"Access-Control-Request-Method": "POST",
				},
				method: "OPTIONS",
			});

			const simple = await fetch(`${serverOrigin}${path}`, {
				headers: { Origin: origin },
			});

			expect(preflight.headers.get("access-control-allow-origin"), label).toBe(
				isAllowed ? origin : null,
			);

			expect(simple.headers.get("access-control-allow-origin"), label).toBe(
				isAllowed ? origin : null,
			);

			expect(varyIncludesOrigin(preflight), label).toBe(true);
			expect(varyIncludesOrigin(simple), label).toBe(true);

			if (isAllowed)
				expect(preflight.headers.get("access-control-max-age"), label).toBe(
					"600",
				);
		}

		const signOut = await fetch(`${serverOrigin}/api/auth/sign-out`, {
			body: JSON.stringify({}),
			headers: {
				"Content-Type": "application/json",
				Cookie: "probe=1",
				Origin: origin,
			},
			method: "POST",
		});

		const signOutBody = await signOut.text();
		if (isAllowed) expect(signOut.status, signOutBody).toBeLessThan(400);
		else expect(signOut.status, signOutBody).toBe(403);
	}
}

async function webOriginsOf(projectRoot: string, env: NodeJS.ProcessEnv) {
	const probe = await runCommand(
		"pnpm",
		[
			"exec",
			"dotenv",
			"-e",
			"../../.env",
			"--",
			"tsx",
			"-e",
			'import("@acme/auth/env").then(({ webOrigins }) => console.log(JSON.stringify(webOrigins)))',
		],
		{ cwd: join(projectRoot, "apps/server"), env: scriptEnvironment(env) },
	);

	expect(probe.exitCode, `${probe.stdout}\n${probe.stderr}`).toBe(0);
	const parsed: unknown = JSON.parse(
		probe.stdout.trim().split("\n").at(-1) ?? "",
	);

	return parsed;
}

async function expectProductionOrigins(
	projectRoot: string,
	options: {
		readonly host: "server" | "nextjs";
		readonly paths: ReadonlyArray<string>;
		readonly passkeyProbe: boolean;
	},
) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const serverOrigin = generatedEnv.APP_ORIGIN;
	if (serverOrigin === undefined)
		throw new Error(`Missing Generated Origin: ${projectRoot}`);

	const primary = "https://app.example.test";
	const production = {
		APP_ORIGIN:
			options.host === "nextjs" ? primary : "https://api.example.test",
		PORT: new URL(serverOrigin).port,
		WEB_URL: primary,
		WEB_URLS: "",
	};

	await withGeneratedServer(
		projectRoot,
		production,
		serverOrigin,
		async () => {
			await expectCorsPolicy(
				serverOrigin,
				options.paths,
				[primary],
				["http://localhost:3002"],
			);
		},
		options.host,
		"start",
	);

	if (options.passkeyProbe)
		expect(await webOriginsOf(projectRoot, production)).toEqual([primary]);

	const first = "https://a.example.test";
	const second = "https://b.example.test";
	const ci = {
		...production,
		APP_ORIGIN: options.host === "nextjs" ? first : production.APP_ORIGIN,
		CI: "1",
		WEB_URL: first,
		WEB_URLS: `${first}/,${second}`,
	};

	await withGeneratedServer(
		projectRoot,
		ci,
		serverOrigin,
		async () => {
			await expectCorsPolicy(
				serverOrigin,
				options.paths,
				[first, second],
				["http://localhost:3002", "https://c.example.test"],
			);
		},
		options.host,
		"start",
	);

	if (options.passkeyProbe)
		expect(await webOriginsOf(projectRoot, ci)).toEqual([first, second]);

	await withGeneratedServer(
		projectRoot,
		{ ...ci, WEB_URLS: "" },
		serverOrigin,
		async (output) => {
			const session = await fetch(`${serverOrigin}/api/auth/get-session`, {
				headers: { Origin: first },
			});

			expect(session.status, output()).toBe(200);
		},
		options.host,
		"start",
	);
}

function stringField(value: unknown, key: string): string | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const field: unknown = Reflect.get(value, key);
	return typeof field === "string" ? field : undefined;
}

const smokePassword = "forge-smoke-password";

function authRequests(origin: string, output: () => string) {
	const request = async (path: string, cookie: string, body?: unknown) => {
		const response = await fetch(`${origin}/api/auth${path}`, {
			...(body === undefined
				? {}
				: { body: JSON.stringify(body), method: "POST" }),
			headers: {
				"Content-Type": "application/json",
				Cookie: cookie,
				Origin: origin,
			},
		});

		const text = await response.text();
		const json: unknown = text === "" ? null : JSON.parse(text);
		return { json, response, status: response.status, text };
	};

	const signUp = async (email: string, name: string) => {
		const result = await request("/sign-up/email", "", {
			email,
			name,
			password: smokePassword,
		});

		expect(result.status, `${result.text}\n${output()}`).toBe(200);
		return cookieHeader(result.response);
	};

	return { request, signUp };
}

async function expectInvitationFlow(projectRoot: string, projectName: string) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const origin = generatedEnv.APP_ORIGIN;
	if (origin === undefined)
		throw new Error(`Missing Generated Origin: ${projectRoot}`);

	await expectSchemaPush(projectRoot);
	await withGeneratedServer(
		projectRoot,
		{},
		origin,
		async (output) => {
			const { request, signUp } = authRequests(origin, output);
			const owner = await signUp("owner@example.com", "Ada Owner");
			const enable = await request("/two-factor/enable", owner, {
				password: smokePassword,
			});

			const totpURI = stringField(enable.json, "totpURI");
			if (totpURI === undefined)
				throw new Error(`Missing TOTP URI: ${enable.text}`);

			expect(new URL(totpURI).searchParams.get("issuer")).toBe(projectName);
			expect(totpURI).not.toContain("Better%20Auth");

			const organizations = [];
			for (let index = 1; index <= 6; index += 1)
				organizations.push(
					await request("/organization/create", owner, {
						name: `Smoke Org ${index}`,
						slug: `smoke-org-${index}`,
					}),
				);

			expect(
				organizations.map(({ status }) => status),
				organizations.map(({ text }) => text).join("\n"),
			).toEqual([200, 200, 200, 200, 200, 403]);

			expect(organizations[5]?.json).toMatchObject({
				code: "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS",
			});

			const organizationId = stringField(organizations[0]?.json, "id");
			if (organizationId === undefined)
				throw new Error("Missing Organization: smoke create");

			const refused = await request("/organization/invite-member", owner, {
				email: "invitee@example.com",
				organizationId,
				role: "member",
			});

			expect(refused.status, refused.text).toBe(400);
			expect(refused.text).toContain(
				"Invitations need an email provider, so this project can't send them yet.",
			);

			expect(output()).not.toMatch(/invitee@example\.com/);
		},
		"nextjs",
		"start",
	);

	await withGeneratedServer(
		projectRoot,
		{},
		origin,
		async (output) => {
			const { request, signUp } = authRequests(origin, output);
			const owner = await signUp("dev-owner@example.com", "Lin Developer");
			const organization = await request("/organization/create", owner, {
				name: "Dev Guild",
				slug: "dev-guild",
			});

			const organizationId = stringField(organization.json, "id");
			if (organizationId === undefined)
				throw new Error(`Missing Organization: ${organization.text}`);

			const invitation = await request("/organization/invite-member", owner, {
				email: "dev-invitee@example.com",
				organizationId,
				role: "member",
			});

			const invitationId = stringField(invitation.json, "id");
			if (invitationId === undefined)
				throw new Error(`Missing Invitation: ${invitation.text}`);

			await waitForOutput(output, "Invitation to Dev Guild");

			const logged = output().match(
				/Invitation to Dev Guild for (\S+) from (\S+): (\S+)/,
			);

			expect(logged, output()).not.toBeNull();
			expect(logged?.[1]).toBe("dev-invitee@example.com");
			expect(logged?.[2]).toBe("dev-owner@example.com");

			const link = new URL(logged?.[3] ?? "");
			expect(link.origin).toBe(origin);
			expect(link.pathname).toBe(`/accept-invitation/${invitationId}`);

			const page = await fetch(link);
			expect(page.status, output()).toBe(200);
			expect(await page.text()).toContain("Checking your session.");

			const invitations = [];
			for (let index = 2; index <= 21; index += 1)
				invitations.push(
					await request("/organization/invite-member", owner, {
						email: `dev-invitee-${index}@example.com`,
						organizationId,
						role: "member",
					}),
				);

			expect(
				invitations.map(({ status }) => status),
				invitations.map(({ text }) => text).join("\n"),
			).toEqual([...Array.from({ length: 19 }, () => 200), 403]);

			expect(invitations[19]?.json).toMatchObject({
				code: "INVITATION_LIMIT_REACHED",
			});

			const invitee = await signUp("dev-invitee@example.com", "Grace Invitee");
			const accepted = await request(
				"/organization/accept-invitation",
				invitee,
				{ invitationId },
			);

			expect(accepted.status, accepted.text).toBe(200);

			const memberships = await request("/organization/list", invitee);
			expect(memberships.status, memberships.text).toBe(200);
			expect(
				Array.isArray(memberships.json) &&
					memberships.json.some(
						(organization) =>
							stringField(organization, "id") === organizationId,
					),
				memberships.text,
			).toBe(true);
		},
		"nextjs",
		"dev",
	);
}

async function writeOrpcCallerProbe(
	projectRoot: string,
	web: "react-router" | "tanstack-start",
) {
	const callerProbe =
		web === "tanstack-start"
			? `import "@tanstack/react-start";
import { ORPCError } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";
import { client } from "../../orpc/client";
import { createServerCaller } from "../../orpc/server";

export const Route = createFileRoute("/api/caller-probe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (typeof client.health !== "function") throw new Error("Missing Browser Client");

        const caller = await createServerCaller(request);

        try {
          return Response.json({ health: await caller.health(), me: await caller.me() });
        } catch (error) {
          if (error instanceof ORPCError) return Response.json({ code: error.code }, { status: error.status });

          throw error;
        }
      },
    },
  },
});
`
			: `import { ORPCError } from "@orpc/server";
import { client } from "../orpc/client";
import { createServerCaller } from "../orpc/server";

export async function loader({ request }: { request: Request }) {
  if (typeof client.health !== "function") throw new Error("Missing Browser Client");

  const caller = await createServerCaller(request);

  try {
    return Response.json({ health: await caller.health(), me: await caller.me() });
  } catch (error) {
    if (error instanceof ORPCError) return Response.json({ code: error.code }, { status: error.status });

    throw error;
  }
}
`;

	await writeFile(
		join(
			projectRoot,
			`apps/web/${selfHostSourceRoots[web]}/routes/${web === "tanstack-start" ? "api/caller-probe.ts" : "api.caller-probe.ts"}`,
		),
		callerProbe,
	);

	if (web === "react-router") {
		const routesPath = join(projectRoot, "apps/web/app/routes.ts");

		const routes = await readFile(routesPath, "utf8");

		await writeFile(
			routesPath,
			routes.replace(
				"export default [",
				'export default [\n  route("api/caller-probe", "routes/api.caller-probe.ts"),',
			),
		);
	}
}

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

					await expectInstallBuildAndTypecheck(workspace, "pnpm");

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

	it.each([
		{ primary: "tanstack-router", secondary: "nextjs", backend: "hono" },
		{ primary: "nextjs", secondary: "tanstack-router", backend: "hono" },
		{ primary: "react-router", secondary: "tanstack-start" },
		{ primary: "tanstack-start", secondary: "react-router" },
	])(
		"installs, builds, and typechecks $primary with a $secondary secondary app",
		async ({ primary, secondary, backend }) => {
			await withScenarioWorkspace(
				`smoke-secondary-${primary}-${secondary}`,
				async (workspace) => {
					await createProject(workspace, {
						web: primary,
						backend,
						rpc: "trpc",
						authentication: "better-auth",
						orm: "drizzle",
						database: "sqlite",
						style: "tailwind",
						linter: "biome",
						packageManager: "pnpm",
						webApps: [{ name: "admin", framework: secondary }],
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
				},
			);
		},
		600_000,
	);

	it("installs, builds, and typechecks secondary web apps with a Hono host", async () => {
		await withScenarioWorkspace(
			"smoke-secondary-web-app",
			async (workspace) => {
				await createProject(workspace, {
					web: "tanstack-router",
					backend: "hono",
					rpc: "trpc",
					authentication: "better-auth",
					orm: "drizzle",
					database: "sqlite",
					style: "tailwind",
					linter: "biome",
					packageManager: "pnpm",
					webApps: [{ name: "admin", framework: "tanstack-router" }],
				});

				await expectInstallBuildAndTypecheck(workspace, "pnpm");
			},
		);
	}, 600_000);

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

			await expectInstallAndBuild(workspace, "pnpm");

			const pageTypecheck = await runCommand(
				"pnpm",
				["--filter", "@acme/web", "typecheck"],
				{
					cwd: workspace.projectRoot,
					env: forgeEnvironment(workspace.workspaceRoot),
				},
			);

			expect(
				pageTypecheck.exitCode,
				`${pageTypecheck.stdout}\n${pageTypecheck.stderr}`,
			).toBe(0);

			await expectInvitationFlow(workspace.projectRoot, "Acme Works");
		});
	}, 600_000);

	it.each(["tanstack-router", "react-router"])(
		"installs, builds, and typechecks %s with an oRPC Hono host",
		async (web) => {
			await withScenarioWorkspace(
				`smoke-orpc-hono-${web}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web,
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
						webOrigin:
							web === "react-router"
								? "http://localhost:5173"
								: "http://localhost:3000",
					});
				},
			);
		},
		600_000,
	);

	it.each(["trpc", undefined] as const)(
		"installs, builds, and typechecks react-router beside Hono with rpc %s",
		async (rpc) => {
			await withScenarioWorkspace(
				`smoke-hono-react-router-${rpc ?? "auth"}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc,
						style: "tailwind",
						web: "react-router",
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");

					if (rpc === "trpc")
						await expectCredentialedGeneratedServer(workspace.projectRoot, {
							webOrigin: "http://localhost:5173",
						});
				},
			);
		},
		600_000,
	);

	it("installs, builds, and hydrates Next.js as an oRPC self host", async () => {
		await withScenarioWorkspace("smoke-orpc-self-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password"],
				backend: "self",
				database: "sqlite",
				orm: "drizzle",
				packageManager: "pnpm",
				rpc: "orpc",
				style: "tailwind",
				web: "nextjs",
			});

			const probeRoot = join(
				workspace.projectRoot,
				"apps/web/app/api/caller-probe",
			);

			await mkdir(probeRoot, { recursive: true });
			await writeFile(
				join(probeRoot, "route.ts"),
				`import { ORPCError } from "@orpc/server";
import { createServerCaller } from "@/orpc/server";

export async function GET() {
  const caller = await createServerCaller();

  try {
    return Response.json({ health: await caller.health(), me: await caller.me() });
  } catch (error) {
    if (error instanceof ORPCError) return Response.json({ code: error.code }, { status: error.status });

    throw error;
  }
}
`,
			);

			const hydrationRoot = join(
				workspace.projectRoot,
				"apps/web/app/api/hydration-probe",
			);

			await mkdir(hydrationRoot, { recursive: true });
			await writeFile(
				join(hydrationRoot, "route.ts"),
				`import { createServerCaller } from "@/orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { dehydrate, QueryClient } from "@tanstack/react-query";

export async function GET() {
  const caller = await createServerCaller();
  const orpc = createTanstackQueryUtils(caller);
  const queryClient = new QueryClient();

  await queryClient.fetchQuery(orpc.health.queryOptions());

  return Response.json(dehydrate(queryClient));
}
`,
			);

			await expectInstallBuildAndTypecheck(workspace, "pnpm");
			await expectSelfHostedRpc(workspace.projectRoot, {
				web: "nextjs",
				rpc: "orpc",
			});
		});
	}, 600_000);

	it.each(["express", "fastify"])(
		"installs, builds, and typechecks TanStack Router with an oRPC %s host",
		async (backend) => {
			await withScenarioWorkspace(
				`smoke-orpc-${backend}-spa`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend,
						database: "sqlite",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web: "tanstack-router",
					});

					if (backend === "express") {
						const contextPath = join(
							workspace.projectRoot,
							"packages/orpc/src/orpc.ts",
						);

						const context = await readFile(contextPath, "utf8");
						expect(context).toContain("): Promise<Context> {");

						await writeFile(
							contextPath,
							context.replace(
								"): Promise<Context> {",
								`): Promise<Context> {
  if (opts.headers.get("x-context-probe") === "fail") throw new Error("Context Probe Failed");`,
							),
						);
					}

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
					});

					if (backend === "express")
						await expectUnrelatedOrpcRequests(workspace.projectRoot);
				},
			);
		},
		600_000,
	);

	it.each([
		{ web: "tanstack-start", rpc: "orpc", orm: "drizzle", secondary: false },
		{ web: "react-router", rpc: "orpc", orm: "drizzle", secondary: false },
		{ web: "tanstack-start", rpc: "orpc", orm: "drizzle", secondary: true },
		{ web: "react-router", rpc: "orpc", orm: "drizzle", secondary: true },
		{ web: "tanstack-start", rpc: "trpc", orm: "drizzle", secondary: false },
		{
			web: "react-router",
			rpc: "trpc",
			orm: "drizzle",
			secondary: false,
			injectPort: true,
		},
		{ web: "react-router", rpc: "orpc", orm: "prisma", secondary: false },
	] as const)(
		"installs, builds, and starts $web as a $rpc self host on $orm (secondary: $secondary)",
		async (cell) => {
			const { web, rpc, orm, secondary } = cell;
			await withScenarioWorkspace(
				`smoke-${rpc}-self-${web}-${orm}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						authMethods: ["email-password"],
						backend: "self",
						database: "sqlite",
						orm,
						packageManager: "pnpm",
						rpc,
						style: "tailwind",
						web,
						...(secondary
							? {
									webApps: [
										{ name: "admin", framework: "nextjs", client: true },
									],
								}
							: {}),
					});

					if (rpc === "orpc")
						await writeOrpcCallerProbe(workspace.projectRoot, web);

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectSelfHostedRpc(workspace.projectRoot, {
						web,
						rpc,
						injectPort: "injectPort" in cell,
						...(secondary
							? {
									clientOrigin:
										web === "react-router"
											? "http://localhost:5174"
											: "http://localhost:3002",
								}
							: {}),
					});
				},
			);
		},
		600_000,
	);

	it.each(["nextjs", "tanstack-start"])(
		"installs, builds, and typechecks %s as an oRPC Hono client",
		async (web) => {
			await withScenarioWorkspace(
				`smoke-orpc-hono-${web}`,
				async (workspace) => {
					await createProject(workspace, {
						authentication: "better-auth",
						backend: "hono",
						database: "sqlite",
						orm: "drizzle",
						packageManager: "pnpm",
						rpc: "orpc",
						style: "tailwind",
						web,
					});

					await expectInstallBuildAndTypecheck(workspace, "pnpm");
					await expectCredentialedGeneratedServer(workspace.projectRoot, {
						rpc: "orpc",
					});
				},
			);
		},
		600_000,
	);

	it("installs, builds, and typechecks Next.js with a Hono API host", async () => {
		await withScenarioWorkspace("smoke-hono-nextjs", async (workspace) => {
			await createProject(workspace, {
				authentication: "better-auth",
				authMethods: ["email-password", "google", "apple", "passkey"],
				authPlugins: ["username", "admin", "polar"],
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
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				passkey: true,
				polar: true,
				username: "hono_smoke",
			});
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
				authPlugins: ["polar"],
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
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				polar: true,
			});
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
				authPlugins: ["polar"],
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
			await expectCredentialedGeneratedServer(workspace.projectRoot, {
				polar: true,
			});
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

	it("installs a prisma project, generates the client, typechecks, and pushes", async () => {
		await withScenarioWorkspace("smoke-prisma", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(
				workspace.projectRoot,
				postgresDatabaseEnv("forge_smoke_prisma"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle project with trpc and tailwind", async () => {
		await withScenarioWorkspace("smoke-drizzle", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await createSmokeDatabase(
				workspace.projectRoot,
				"postgresql",
				"forge_smoke_drizzle",
			);

			await expectSchemaPush(
				workspace.projectRoot,
				postgresDatabaseEnv("forge_smoke_drizzle"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle mysql project", async () => {
		await withScenarioWorkspace("smoke-drizzle-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await createSmokeDatabase(
				workspace.projectRoot,
				"mysql",
				"forge_smoke_drizzle_mysql",
			);

			await expectSchemaPush(
				workspace.projectRoot,
				mysqlDatabaseEnv("forge_smoke_drizzle_mysql"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle planetscale mysql project", async () => {
		await withScenarioWorkspace(
			"smoke-drizzle-planetscale-mysql",
			async (workspace) => {
				await createProject(
					workspace,
					{
						...authPluginConfig,
						authentication: "better-auth",
						database: "mysql",
						databaseProvider: "planetscale",
						linter: "biome",
						orm: "drizzle",
						packageManager: "pnpm",
						style: "tailwind",
						web: "nextjs",
					},
					{ install: true },
				);

				await expectPasskeyInstallAndTypecheck(workspace);
				await createSmokeDatabase(
					workspace.projectRoot,
					"mysql",
					"forge_smoke_drizzle_planetscale",
				);

				await expectSchemaPush(
					workspace.projectRoot,
					mysqlDatabaseEnv("forge_smoke_drizzle_planetscale"),
				);
			},
		);
	}, 600_000);

	it("installs, typechecks, and pushes a prisma mysql project", async () => {
		await withScenarioWorkspace("smoke-prisma-mysql", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "mysql",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(
				workspace.projectRoot,
				mysqlDatabaseEnv("forge_smoke_prisma_mysql"),
			);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a prisma sqlite project", async () => {
		await withScenarioWorkspace("smoke-prisma-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
					authentication: "better-auth",
					database: "sqlite",
					linter: "biome",
					orm: "prisma",
					packageManager: "pnpm",
					style: "tailwind",
					web: "nextjs",
				},
				{ install: true },
			);

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a drizzle sqlite project", async () => {
		await withScenarioWorkspace("smoke-drizzle-sqlite", async (workspace) => {
			await createProject(
				workspace,
				{
					...authPluginConfig,
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

			await expectPasskeyInstallAndTypecheck(workspace);
			await expectSchemaPush(workspace.projectRoot);
		});
	}, 600_000);

	it("installs, typechecks, and pushes a prisma planetscale mysql passkey project", async () => {
		await withScenarioWorkspace(
			"smoke-prisma-planetscale-passkey",
			async (workspace) => {
				await createProject(
					workspace,
					{
						...authPluginConfig,
						authentication: "better-auth",
						database: "mysql",
						databaseProvider: "planetscale",
						linter: "biome",
						orm: "prisma",
						packageManager: "pnpm",
						web: "nextjs",
					},
					{ install: true },
				);

				await expectPasskeyInstallAndTypecheck(workspace);
				await expectSchemaPush(
					workspace.projectRoot,
					mysqlDatabaseEnv("forge_smoke_prisma_mysql"),
				);
			},
		);
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
				authPlugins: ["polar"],
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

	it.each([
		{
			name: "default",
			config: {
				addons: ["commitlint", "github-ci", "lefthook", "vscode"],
				authentication: "better-auth",
				backend: "self",
				catalogs: "scoped",
				database: "postgresql",
				databaseProvider: "neon",
				orm: "drizzle",
				rpc: "trpc",
				style: "tailwind",
				uiLibrary: "base-ui",
				web: "nextjs",
			},
		},
		{
			name: "full-stack",
			config: {
				addons: ["commitlint", "github-ci", "lefthook", "vscode"],
				authentication: "better-auth",
				authMethods: ["email-password", "passkey", "email-otp"],
				backend: "hono",
				catalogs: "scoped",
				database: "sqlite",
				emailProvider: "resend",
				orm: "drizzle",
				rpc: "orpc",
				style: "tailwind",
				uiLibrary: "base-ui",
				web: "tanstack-router",
				webApps: [{ name: "admin", framework: "nextjs" }],
			},
		},
	])(
		"passes its own Oxc check on a fresh $name project",
		async ({ name, config }) => {
			await withScenarioWorkspace(`smoke-oxc-${name}`, async (workspace) => {
				await createProject(workspace, {
					...config,
					linter: "oxc",
					packageManager: "pnpm",
				});

				await expectFreshLinterCheck(workspace, {
					configFiles: [".oxlintrc.json", ".oxfmtrc.json"],
					devDependencies: ["oxlint", "oxfmt"],
					absentConfigFiles: ["biome.json"],
					absentDevDependencies: ["@biomejs/biome"],
				});
			});
		},
		600_000,
	);
});
