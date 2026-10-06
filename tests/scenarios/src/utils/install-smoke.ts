import { AsyncLocalStorage } from "node:async_hooks";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createContext, Script } from "node:vm";
import { ManifestSchema } from "@ryuugg/core";
import { Schema } from "effect";
import { build } from "vite";
import { expect, inject } from "vitest";
import { expectEmailAuth } from "../utils/email-auth";
import {
	expectInstallAndTypecheck,
	type ForgeCommandResult,
	forgeEnvironment,
	pathExists,
	readJson,
	runCommand,
	type ScenarioProject,
} from "../utils/harness";

import { expectPasskeyCeremony } from "../utils/passkey";

const portLockStore = new AsyncLocalStorage<true>();

function errorCode(error: unknown) {
	return error instanceof Error && "code" in error ? error.code : undefined;
}

function lockHolderAlive(holder: string) {
	const pid = Number(holder.split(" ")[0]);
	if (!Number.isSafeInteger(pid) || pid <= 0) return true;

	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (errorCode(error) === "ESRCH") return false;
		throw error;
	}
}

async function readLockHolder(path: string) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return undefined;
		throw error;
	}
}

async function releaseLockHeldBy(path: string, holder: string) {
	if ((await readLockHolder(path)) === holder) await rm(path, { force: true });
}

async function withPortLock<T>(run: () => Promise<T>): Promise<T> {
	if (portLockStore.getStore() === true) return run();

	const path = join(inject("portLockDir"), "ports.lock");
	const token = `${process.pid} ${randomUUID()}`;
	while (true) {
		try {
			await writeFile(path, token, { flag: "wx" });
			break;
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
		}

		const holder = await readLockHolder(path);
		if (holder === undefined) continue;

		if (!lockHolderAlive(holder)) {
			await releaseLockHeldBy(path, holder);
			continue;
		}

		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}

	try {
		return await portLockStore.run(true, run);
	} finally {
		await releaseLockHeldBy(path, token);
	}
}

export const postgresProviderCells = [
	{ provider: "planetscale", transaction: "supported", client: "pg" },
	{ provider: "neon", transaction: "unsupported", client: "pg" },
	{ provider: "nile", transaction: "supported", client: "pg" },
	{ provider: "supabase", transaction: "supported", client: "postgres" },
	{ provider: "prisma-postgres", transaction: "supported", client: "pg" },
] as const satisfies ReadonlyArray<{
	readonly provider: string;
	readonly transaction: "supported" | "unsupported";
	readonly client: "pg" | "postgres";
}>;

export const transactionProbeSource = `import { db } from "@acme/db/client";
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

const userDeleteClientSource = `import { relations } from "@acme/db/relations";
import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2/promise";

export const client = createPool({ uri: process.env.DATABASE_URL, timezone: "Z" });
export const db = drizzle({ client, relations });
`;

const userDeleteProbeSource = `import { randomUUID } from "node:crypto";
import { eq } from "@acme/db";
import { db, client } from "@acme/db/client";
import { accounts, invitations, members, organizations, passkeys, sessions, two_factors } from "@acme/db/schema";
import { auth } from "./index.ts";

const targets = [
  { name: "accounts", table: accounts, column: accounts.userId },
  { name: "sessions", table: sessions, column: sessions.userId },
  { name: "passkeys", table: passkeys, column: passkeys.userId },
  { name: "two_factors", table: two_factors, column: two_factors.userId },
  { name: "members", table: members, column: members.userId },
  { name: "invitations", table: invitations, column: invitations.inviterId },
];

async function expectUserRows(userId, expected) {
  for (const { name, table, column } of targets) {
    const rows = await db.select().from(table).where(eq(column, userId));
    if (rows.length !== expected)
      throw new Error(\`User Cleanup Mismatch: \${name} for \${userId} expected \${expected}, received \${rows.length}\`);
  }
}

async function seedUserRows(userId, organizationId) {
  await db.insert(accounts).values({
    id: randomUUID(), userId, accountId: userId, providerId: "credential",
  });

  await db.insert(sessions).values({
    id: randomUUID(), userId, token: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
  });

  await db.insert(passkeys).values({
    id: randomUUID(), userId, publicKey: "smoke-key", credentialID: randomUUID(),
    counter: 0, deviceType: "singleDevice", backedUp: false, createdAt: new Date(),
  });

  await db.insert(two_factors).values({
    id: randomUUID(), userId, secret: "smoke-secret", backupCodes: "[]",
  });

  await db.insert(members).values({
    id: randomUUID(), userId, organizationId, role: "member", createdAt: new Date(),
  });

  await db.insert(invitations).values({
    id: randomUUID(), inviterId: userId, organizationId,
    email: \`invite-\${userId}@example.com\`, expiresAt: new Date(Date.now() + 60_000),
  });
}

try {
  const [foreignKeys] = await client.query(
    "SELECT COUNT(*) AS count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()",
  );
  if (Number(foreignKeys[0]?.count) !== 0)
    throw new Error(\`Unexpected Foreign Keys: \${JSON.stringify(foreignKeys)}\`);

  const { internalAdapter } = await auth.$context;
  const first = await internalAdapter.createUser({
    name: "First", email: "first@example.com", emailVerified: true,
  });
  const second = await internalAdapter.createUser({
    name: "Second", email: "second@example.com", emailVerified: true,
  });

  const organizationId = randomUUID();
  await db.insert(organizations).values({
    id: organizationId, name: "Smoke", slug: "smoke", createdAt: new Date(),
  });

  await seedUserRows(first.id, organizationId);
  await seedUserRows(second.id, organizationId);

  await expectUserRows(first.id, 1);
  await expectUserRows(second.id, 1);

  await internalAdapter.deleteUser(first.id);

  await expectUserRows(first.id, 0);
  await expectUserRows(second.id, 1);
} finally {
  await client.end();
}

process.exit(0);
`;

export async function runUserDeleteProbe(
	workspace: ScenarioProject,
	url: string,
): Promise<ForgeCommandResult> {
	const authRoot = join(workspace.projectRoot, "packages/auth");
	const server = await readFile(join(authRoot, "src/index.ts"), "utf-8");
	expect(server).toContain("databaseHooks");

	const clientPath = join(
		workspace.projectRoot,
		"packages/db/src/user-delete-client.ts",
	);

	await writeFile(clientPath, userDeleteClientSource);
	await writeFile(
		join(authRoot, "src/user-delete-probe.mjs"),
		userDeleteProbeSource,
	);

	const hookPath = join(workspace.workspaceRoot, "user-delete-resolve.mjs");
	await writeFile(
		hookPath,
		`${typeScriptResolveHookSource}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@acme/db/client")
      return nextResolve(${JSON.stringify(pathToFileURL(clientPath).href)}, context);

    return nextResolve(specifier, context);
  },
});
`,
	);

	return await runCommand(
		"node",
		["--import", hookPath, "src/user-delete-probe.mjs"],
		{
			cwd: authRoot,
			env: {
				...forgeEnvironment(workspace.workspaceRoot),
				...(await readGeneratedEnv(workspace.projectRoot)),
				DATABASE_URL: url,
			},
		},
	);
}

export function smokeDatabaseUrl() {
	const url = process.env.FORGE_SMOKE_DATABASE_URL;
	if (url === undefined)
		throw new Error("Missing Smoke Database: FORGE_SMOKE_DATABASE_URL");

	return url;
}

export async function runTransactionProbe(
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

export async function readGeneratedEnv(projectRoot: string) {
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

export async function webAppsOf(projectRoot: string): Promise<WebApp[]> {
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

		const primaryOrigin = generatedEnv.WEB_URL ?? generatedEnv.APP_ORIGIN;
		let port: unknown;
		if (primary && primaryOrigin !== undefined) {
			const originPort = new URL(primaryOrigin).port;
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

export const authPluginConfig = {
	authMethods: ["email-password", "google", "passkey"],
	authPlugins: ["two-factor", "username", "admin", "organization"],
};

export function smokeMysqlUrl() {
	const url = process.env.FORGE_SMOKE_MYSQL_URL;
	if (url === undefined)
		throw new Error("Missing Smoke Database: FORGE_SMOKE_MYSQL_URL");

	return url;
}

export function smokeDatabaseOn(serverUrl: string, name: string) {
	const url = new URL(serverUrl);
	url.pathname = `/${name}`;
	return url.toString();
}

const createDatabaseScripts = {
	pg: (name: string) =>
		[
			'import pg from "pg";',
			`const client = new pg.Client({ connectionString: ${JSON.stringify(smokeDatabaseUrl())} });`,
			"await client.connect();",
			`await client.query(${JSON.stringify(`DROP DATABASE IF EXISTS "${name}"`)});`,
			`await client.query(${JSON.stringify(`CREATE DATABASE "${name}"`)});`,
			"await client.end();",
		].join("\n"),
	postgres: (name: string) =>
		[
			'import postgres from "postgres";',
			`const sql = postgres(${JSON.stringify(smokeDatabaseUrl())});`,
			`await sql.unsafe(${JSON.stringify(`DROP DATABASE IF EXISTS "${name}"`)});`,
			`await sql.unsafe(${JSON.stringify(`CREATE DATABASE "${name}"`)});`,
			"await sql.end();",
		].join("\n"),
	mysql2: (name: string) =>
		[
			'import mysql from "mysql2/promise";',
			`const connection = await mysql.createConnection(${JSON.stringify(smokeMysqlUrl())});`,
			`await connection.query(${JSON.stringify(`DROP DATABASE IF EXISTS \`${name}\``)});`,
			`await connection.query(${JSON.stringify(`CREATE DATABASE \`${name}\``)});`,
			"await connection.end();",
		].join("\n"),
};

export async function createSmokeDatabase(
	projectRoot: string,
	driver: keyof typeof createDatabaseScripts,
	name: string,
) {
	const result = await runCommand(
		"node",
		["--input-type=module", "-e", createDatabaseScripts[driver](name)],
		{ cwd: join(projectRoot, "packages/db") },
	);

	expect(
		result.exitCode,
		`creating database ${name} failed with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
	).toBe(0);
}

export async function expectSchemaPush(
	projectRoot: string,
	env?: NodeJS.ProcessEnv,
) {
	const push = await runCommand("pnpm", ["db:push"], {
		cwd: join(projectRoot, "apps/web"),
		env,
	});

	expect(
		push.exitCode,
		`pnpm db:push failed with code ${push.exitCode}\n${push.stdout}\n${push.stderr}`,
	).toBe(0);
}

export async function expectPasskeyInstallAndTypecheck(
	workspace: ScenarioProject,
) {
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

export function postgresDatabaseEnv(name: string): NodeJS.ProcessEnv {
	const url = smokeDatabaseOn(smokeDatabaseUrl(), name);
	return { DATABASE_URL: url, DATABASE_DIRECT_URL: url };
}

export function mysqlDatabaseEnv(name: string): NodeJS.ProcessEnv {
	return { DATABASE_URL: smokeDatabaseOn(smokeMysqlUrl(), name) };
}

type ServerLaunch = "node" | "dev" | "start";

export function scriptEnvironment(
	overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
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

async function stopChild(
	child: ChildProcessWithoutNullStreams,
	exited: Promise<unknown>,
) {
	if (child.pid === undefined) return;
	if (child.exitCode === null) child.kill("SIGTERM");

	const stopped = await Promise.race([
		exited.then(() => true),
		new Promise<false>((resolveWait) =>
			setTimeout(() => resolveWait(false), 5_000),
		),
	]);

	if (!stopped) child.kill("SIGKILL");

	await exited;
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

async function stopDetached(pid: number) {
	stopProcessGroup(pid, "SIGTERM");

	for (let attempt = 0; attempt < 50 && processGroupAlive(pid); attempt += 1)
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));

	stopProcessGroup(pid, "SIGKILL");

	const killDeadline = Date.now() + 5_000;
	while (Date.now() < killDeadline && processGroupAlive(pid))
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
}

export async function withGeneratedServer(
	projectRoot: string,
	env: NodeJS.ProcessEnv,
	serverOrigin: string,
	exercise: (output: () => string) => Promise<void>,
	host: "server" | "nextjs" | "tanstack-start" = "server",
	launch: ServerLaunch = "node",
) {
	return withPortLock(async () => {
		const cwd = join(
			projectRoot,
			host === "server" ? "apps/server" : "apps/web",
		);

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
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline) {
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

			try {
				await exercise(() => output);
			} catch (error) {
				if (error instanceof TypeError)
					throw new Error(`Generated Server Unreachable: ${output}`, {
						cause: error,
					});

				throw error;
			}
		} finally {
			const pid = server.pid;
			if (launch === "node" || pid === undefined)
				await stopChild(server, exited);
			else await stopDetached(pid);
		}
	});
}

async function signInFromAddress(
	serverOrigin: string,
	origin: string,
	localAddress: string,
	forwarded: string,
	platformClient?: string,
): Promise<number> {
	const body = JSON.stringify({
		email: "rate-limit-missing@example.com",
		password: "forge-smoke-password",
	});

	return new Promise((resolveStatus, rejectStatus) => {
		const request = httpRequest(
			`${serverOrigin}/api/auth/sign-in/email`,
			{
				method: "POST",
				localAddress,
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
					Origin: origin,
					"X-Forwarded-For": forwarded,
					...(platformClient === undefined
						? {}
						: { "X-Real-IP": platformClient }),
				},
			},
			(response) => {
				response.on("error", rejectStatus);
				response.resume();
				response.on("end", () => {
					if (response.statusCode === undefined)
						rejectStatus(new Error("Missing Auth Status: sign-in response"));
					else resolveStatus(response.statusCode);
				});
			},
		);

		request.on("error", rejectStatus);
		request.setTimeout(5_000, () => {
			request.destroy(new Error("Auth Request Timeout: client address smoke"));
		});

		request.end(body);
	});
}

export async function expectClientIpRateLimit(
	projectRoot: string,
	host: "server" | "tanstack-start",
) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const appOrigin = generatedEnv.APP_ORIGIN;
	if (appOrigin === undefined)
		throw new Error(`Missing Generated Origin: ${projectRoot}`);

	const port = new URL(appOrigin).port;
	const serverOrigin = `http://127.0.0.1:${port}`;
	const origin = generatedEnv.WEB_URL || appOrigin;
	const cases = [
		{
			name: "trusted proxy",
			clientIpHeader: undefined,
			proxies: "127.0.0.1/32",
			localAddress: "127.0.0.1",
			variesForwarded: false,
			nextAddress: "127.0.0.1",
		},
		{
			name: "untrusted socket",
			clientIpHeader: undefined,
			proxies: "127.0.0.1/32",
			localAddress: "127.0.0.2",
			variesForwarded: true,
			nextAddress: undefined,
		},
		{
			name: "direct connection",
			clientIpHeader: undefined,
			proxies: undefined,
			localAddress: "127.0.0.1",
			variesForwarded: true,
			nextAddress: "127.0.0.2",
		},
		{
			name: "platform header",
			proxies: undefined,
			clientIpHeader: "x-real-ip",
			localAddress: "127.0.0.1",
			variesForwarded: true,
			nextAddress: "127.0.0.1",
		},
	];

	await expectSchemaPush(projectRoot, generatedEnv);

	for (const scenario of cases)
		await withGeneratedServer(
			projectRoot,
			{
				...generatedEnv,
				AUTH_TRUSTED_PROXIES: scenario.proxies,
				AUTH_CLIENT_IP_HEADER: scenario.clientIpHeader,
				NODE_ENV: "production",
				PORT: port,
			},
			serverOrigin,
			async (output) => {
				const started = Date.now();

				for (let attempt = 1; attempt <= 4; attempt += 1) {
					const status = await signInFromAddress(
						serverOrigin,
						origin,
						scenario.localAddress,
						`203.0.113.${scenario.variesForwarded ? attempt : 1}`,
						scenario.clientIpHeader && "198.51.100.1",
					);

					expect(
						status,
						`${scenario.name}, attempt ${attempt}\n${output()}`,
					).toBe(attempt === 4 ? 429 : 401);
				}

				if (scenario.nextAddress !== undefined) {
					const status = await signInFromAddress(
						serverOrigin,
						origin,
						scenario.nextAddress,
						"203.0.113.2",
						scenario.clientIpHeader && "198.51.100.2",
					);

					expect(
						status,
						`${scenario.name}, independent client\n${output()}`,
					).toBe(401);
				}

				expect(
					Date.now() - started,
					`${scenario.name} exceeded the rate limit window`,
				).toBeLessThan(10_000);
			},
			host,
			"start",
		);
}

export async function expectEmailPreview(projectRoot: string) {
	return withPortLock(async () => {
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
			if (pid !== undefined) await stopDetached(pid);
		}
	});
}

function sqliteDatabasePath(projectRoot: string, env: NodeJS.ProcessEnv) {
	const url = env.DATABASE_URL;
	if (url === undefined || !url.startsWith("file:"))
		throw new Error(`Missing SQLite Database: ${projectRoot}`);

	return resolve(projectRoot, "apps/server", url.slice("file:".length));
}

export async function expectRelocatedPasskeyCeremony(projectRoot: string) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const serverOrigin = generatedEnv.APP_ORIGIN;
	if (serverOrigin === undefined)
		throw new Error(`Missing Generated Origin: ${projectRoot}`);

	const rpID = "forge.test";
	const origin = "http://admin.forge.test:3002";
	expect(new URL(serverOrigin).hostname).not.toBe(rpID);

	await withGeneratedServer(
		projectRoot,
		{
			PASSKEY_RP_ID: rpID,
			PORT: new URL(serverOrigin).port,
			WEB_URL: "http://app.forge.test:3000",
			WEB_URLS: origin,
		},
		serverOrigin,
		async (output) => {
			const signup = await fetch(`${serverOrigin}/api/auth/sign-up/email`, {
				body: JSON.stringify({
					email: "relocated-passkey@example.com",
					name: "Relocated Passkey",
					password: "forge-smoke-password",
				}),
				headers: { "Content-Type": "application/json", Origin: origin },
				method: "POST",
			});

			expect(signup.status, `${await signup.text()}\n${output()}`).toBe(200);

			const cookie = signup.headers.get("set-cookie")?.split(";", 1)[0];
			if (cookie === undefined)
				throw new Error("Missing Session Cookie: relocated passkey sign-up");

			await expectPasskeyCeremony(serverOrigin, origin, cookie, output, rpID);
		},
		"server",
		"start",
	);
}

export async function expectCredentialedGeneratedServer(
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
				await expectEmailAuth(
					serverOrigin,
					origin,
					output,
					sqliteDatabasePath(projectRoot, generatedEnv),
				);

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

const orpcContextProbeAnchor =
	"const session = await resolveSession(context.headers);";

export async function injectOrpcContextProbe(projectRoot: string) {
	const contextPath = join(projectRoot, "packages/orpc/src/orpc.ts");
	const context = await readFile(contextPath, "utf8");

	expect(context.split(orpcContextProbeAnchor)).toHaveLength(2);

	await writeFile(
		contextPath,
		context.replace(
			orpcContextProbeAnchor,
			`if (context.headers.get("x-context-probe") === "fail")
        throw new Error("Context Probe Failed");

      ${orpcContextProbeAnchor}`,
		),
	);
}

const orpcContextProbeRequest = {
	method: "POST",
	headers: {
		"Content-Type": "application/json",
		"x-context-probe": "fail",
		"x-csrf-token": "orpc",
	},
	body: JSON.stringify({ json: null }),
};

async function expectOrpcContextFailure(origin: string, output: () => string) {
	const logged = output().length;
	const failure = await fetch(
		`${origin}/api/orpc/health`,
		orpcContextProbeRequest,
	);

	expect(failure.status, output()).toBe(500);
	expect(failure.headers.get("content-type")).toContain("application/json");
	expect(await failure.json()).toEqual({
		json: {
			defined: false,
			code: "INTERNAL_SERVER_ERROR",
			status: 500,
			message: "Internal server error",
		},
	});

	await waitForOutput(output, "Context Probe Failed", logged);
	expect(output().slice(logged)).toContain("❌ oRPC failed on health:");
	expect(output().slice(logged)).toContain("Context Probe Failed");
}

async function expectOrpcRouteEdges(origin: string, output: () => string) {
	const missing = await fetch(
		`${origin}/api/orpc/missing`,
		orpcContextProbeRequest,
	);

	expect(missing.status, output()).toBe(404);

	const multipart = async (data: string) => {
		const upload = new FormData();
		upload.set("data", data);
		upload.set("0", new File(["hello"], "a.txt", { type: "text/plain" }));

		return await fetch(`${origin}/api/orpc/health`, {
			method: "POST",
			headers: { "x-csrf-token": "orpc" },
			body: upload,
		});
	};

	const accepted = await multipart(JSON.stringify({ json: {}, maps: [[]] }));

	expect(accepted.status, output()).toBe(200);
	expect(await accepted.json()).toEqual({ json: { status: "ok" } });

	const undecodable = await multipart("not json");

	expect(undecodable.status, output()).toBe(400);
	expect(await undecodable.json()).toEqual({
		json: {
			defined: false,
			code: "BAD_REQUEST",
			status: 400,
			message:
				"Malformed request. Ensure the request body is properly formatted and the 'Content-Type' header is set correctly.",
		},
	});
}

export async function expectStandaloneOrpcRoute(
	projectRoot: string,
	contextProbe: boolean,
) {
	const generatedEnv = await readGeneratedEnv(projectRoot);
	const serverOrigin = generatedEnv.APP_ORIGIN;
	if (serverOrigin === undefined)
		throw new Error(`Missing Generated Origin: ${projectRoot}`);

	await withGeneratedServer(
		projectRoot,
		generatedEnv,
		serverOrigin,
		async (output) => {
			const headers = { "x-context-probe": "fail", "x-csrf-token": "probe" };
			for (const path of ["/missing", "/api/orpc-other/health", "/api/orpc"]) {
				const response = await fetch(`${serverOrigin}${path}`, { headers });
				expect(response.status, path).toBe(404);
			}

			await expectOrpcRouteEdges(serverOrigin, output);
			if (contextProbe) await expectOrpcContextFailure(serverOrigin, output);
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
		define: {
			"process.env.NODE_ENV": JSON.stringify("production"),
			"typeof window": JSON.stringify("object"),
		},
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

export async function signUpSession(
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

export async function bundleText(root: string) {
	const files = await readdir(root, { recursive: true, withFileTypes: true });
	const contents = await Promise.all(
		files
			.filter((file) => file.isFile() && file.name.endsWith(".js"))
			.map((file) => readFile(join(file.parentPath, file.name), "utf8")),
	);

	return contents.join("\n");
}

export async function expectServerOnlyCodeOutOfClientBundle(
	bundles: { readonly client: string; readonly server: string },
	markers: ReadonlyArray<string>,
) {
	const client = await bundleText(bundles.client);
	const server = await bundleText(bundles.server);
	for (const marker of markers) {
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

		await stopDetached(pid);
	});
}

export async function withWebApp(
	projectRoot: string,
	app: WebApp,
	exercise: (output: () => string) => Promise<void>,
) {
	return withPortLock(async () => {
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

				await stopDetached(pid);
			},
		);

		try {
			let ready = false;
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline) {
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
	});
}

export async function expectSelfHostedRpc(
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
	const run = async () => {
		const server = await startSelfHostedServer(
			projectRoot,
			web,
			options.injectPort === true,
		);

		const { origin, output } = server;
		try {
			let ready = false;
			const deadline = Date.now() + 30_000;
			while (Date.now() < deadline) {
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

			if (web !== "nextjs") await expectQuietProductionServer(origin, output);

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

					expect(
						preflight.headers.get("access-control-allow-credentials"),
					).toBe("true");
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
			await expectOrpcRouteEdges(origin, output);
			await expectOrpcContextFailure(origin, output);

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

			const rendered = output().length;
			await fetch(`${origin}/orpc-example`, {
				headers: { Cookie: session.cookie, "x-context-probe": "fail" },
			});

			await waitForOutput(output, "Context Probe Failed", rendered);
			expect(output().slice(rendered)).toContain("❌ oRPC failed on me:");

			await expectServerOnlyCodeOutOfClientBundle(
				{
					client: join(projectRoot, "apps/web/dist/client"),
					server: join(projectRoot, "apps/web/dist/server"),
				},
				["AUTH_SECRET", "DATABASE_URL", "@libsql"],
			);

			await expectBrowserOrpcClientBundle(projectRoot);
		} finally {
			await server.stop();
		}
	};

	return options.web !== "nextjs" && options.injectPort !== true
		? withPortLock(run)
		: run();
}

const secretRequestPaths = {
	SMOKE_SECRET_A: "/api/auth/magic-link/verify?token=SMOKE_SECRET_A",
	SMOKE_SECRET_B: "/api/auth/reset-password/SMOKE_SECRET_B",
	SMOKE_SECRET_C: "/api/auth/callback/google?code=SMOKE_SECRET_C&state=x",
} as const;

async function expectQuietProductionServer(
	origin: string,
	output: () => string,
) {
	for (const path of Object.values(secretRequestPaths))
		await fetch(`${origin}${path}`, { redirect: "manual" }).then((response) =>
			response.arrayBuffer(),
		);

	const page = await fetch(`${origin}/`);
	const html = await page.text();

	expect(page.status, output()).toBe(200);
	expect(page.headers.get("content-type")).toContain("text/html");
	expect(page.headers.get("content-encoding")).toBe("gzip");

	const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
	if (asset === undefined) throw new Error(`Missing Client Asset: ${html}`);

	const file = await fetch(`${origin}${asset}`);

	expect(file.status, output()).toBe(200);
	expect(file.headers.get("cache-control")).toContain("immutable");

	await file.arrayBuffer();

	await new Promise((resolveWait) => setTimeout(resolveWait, 500));

	for (const secret of Object.keys(secretRequestPaths))
		expect(output()).not.toContain(secret);
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

export async function expectDrainingWorker(
	projectRoot: string,
	launch: "node" | "start" = "node",
) {
	return withPortLock(async () => {
		const generatedEnv = await readGeneratedEnv(projectRoot);
		const secret = generatedEnv.WORKER_SECRET;
		if (secret === undefined)
			throw new Error(`Missing Worker Secret: ${projectRoot}`);

		const ambientEnv = { ...process.env };
		delete ambientEnv.CI;

		const cwd = join(projectRoot, "apps/worker");
		const worker =
			launch === "node"
				? spawn("node", ["dist/index.js"], {
						cwd,
						env: { ...ambientEnv, ...generatedEnv },
					})
				: spawn("pnpm", ["run", "start"], {
						cwd,
						detached: true,
						env: { ...process.env, ...scriptEnvironment(generatedEnv) },
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
			const deadline = Date.now() + 30_000;
			while (
				Date.now() < deadline &&
				worker.exitCode === null &&
				worker.signalCode === null
			) {
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
			const pid = worker.pid;
			if (launch === "node" || pid === undefined)
				await stopChild(worker, exited);
			else await stopDetached(pid);
		}

		const exitCode = await exited;
		if (launch === "node") expect(exitCode, output).toBe(0);

		expect(output).not.toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND/);
	});
}

export async function expectBundledNativeWindStyles(
	workspace: ScenarioProject,
) {
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

	return bundle;
}

export async function addExpoOrpcProbeRoute(projectRoot: string) {
	await writeFile(
		join(projectRoot, "apps/mobile/src/app/orpc-probe.tsx"),
		[
			'import { Text } from "react-native";',
			'import { client } from "../lib/orpc";',
			"",
			"export default function OrpcProbe() {",
			"  return <Text onPress={() => void client.health()}>oRPC</Text>;",
			"}",
			"",
		].join("\n"),
	);
}

export function expectNativeOrpcClientBundle(bundle: string) {
	for (const pattern of [/\/api\/orpc/, /["'`]x-csrf-token["'`]/])
		expect(pattern.test(bundle), String(pattern)).toBe(true);
}

function varyIncludesOrigin(response: Response) {
	return (response.headers.get("vary") ?? "")
		.split(",")
		.some((value) => value.trim().toLowerCase() === "origin");
}

async function waitForOutput(output: () => string, text: string, from = 0) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline && output().indexOf(text, from) === -1)
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

export async function expectProductionEmailSecrets(projectRoot: string) {
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

			const unconfigured = "Email isn't configured.";
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
			expect(
				output().indexOf(unconfigured, beforeMagicLink),
				`the magic link send never reached sendEmail: ${magicLinkBody}\n${output()}`,
			).not.toBe(-1);

			const sessionToken = sessionCookie?.split(";", 1)[0];
			if (sessionToken === undefined)
				throw new Error(`Missing Session Cookie: ${cookies.join("\n")}`);

			const otpSends = [
				...["prod-signup@example.com", "prod-smoke@example.com"].flatMap(
					(email) => [
						{
							path: "email-otp/send-verification-otp",
							body: { email, type: "forget-password" },
						},
						{ path: "email-otp/request-password-reset", body: { email } },
						{ path: "forget-password/email-otp", body: { email } },
					],
				),
				{
					path: "email-otp/request-email-change",
					body: { newEmail: "prod-change@example.com" },
					cookie: sessionToken,
				},
			];

			for (const send of otpSends) {
				const otp = await fetch(`${serverOrigin}/api/auth/${send.path}`, {
					body: JSON.stringify(send.body),
					headers:
						"cookie" in send ? { ...headers, Cookie: send.cookie } : headers,
					method: "POST",
				});

				expect(
					{ status: otp.status, body: await otp.text() },
					`${send.path} with ${JSON.stringify(send.body)} must fail like magic link\n${output()}`,
				).toEqual({ status: magicLink.status, body: magicLinkBody });
			}

			await new Promise((resolveWait) => setTimeout(resolveWait, 1000));

			const log = output();
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

export async function expectProductionOrigins(
	projectRoot: string,
	options: {
		readonly host: "server" | "nextjs";
		readonly paths: ReadonlyArray<string>;
		readonly passkeyProbe: boolean;
	},
) {
	return withPortLock(async () => {
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
	});
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

export async function expectInvitationFlow(
	projectRoot: string,
	projectName: string,
) {
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

export async function writeOrpcCallerProbe(
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
        const clientHealth = await client.health();
        if (clientHealth.status !== "ok")
          throw new Error("Unexpected Client Health");

        const caller = await createServerCaller(request);

        try {
          return Response.json({
            health: await caller.health(),
            me: await caller.me(),
          });
        } catch (error) {
          if (error instanceof ORPCError)
            return Response.json(
              { code: error.code },
              { status: error.status },
            );

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
  const browserOnly = await client.health().then(
    () => false,
    (error) =>
      error instanceof ReferenceError && error.message.includes("window"),
  );

  if (!browserOnly) throw new Error("Browser Client Ran On The Server");

  const caller = await createServerCaller(request);

  try {
    return Response.json({
      health: await caller.health(),
      me: await caller.me(),
    });
  } catch (error) {
    if (error instanceof ORPCError)
      return Response.json({ code: error.code }, { status: error.status });

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
