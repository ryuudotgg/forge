import { describe, expect, it } from "vitest";
import type { ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

type Plan = Awaited<ReturnType<typeof plannedProject>>;

interface PackageJson {
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly scripts?: Readonly<Record<string, string>>;
}

function writeContent(plan: Plan, path: string): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
	if (typeof value !== "object" || value === null) return {};

	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

function packageJsonAt(plan: Plan, path: string): PackageJson {
	const parsed: unknown = JSON.parse(writeContent(plan, path));
	if (typeof parsed !== "object" || parsed === null)
		throw new Error(`Invalid Package Json: ${path}`);

	return {
		dependencies:
			"dependencies" in parsed ? stringRecord(parsed.dependencies) : undefined,
		scripts: "scripts" in parsed ? stringRecord(parsed.scripts) : undefined,
	};
}

function envValue(plan: Plan, name: string): string {
	const line = writeContent(plan, ".env")
		.split("\n")
		.find((entry) => entry.startsWith(`${name}=`));

	if (line === undefined) throw new Error(`Missing Env Value: ${name}`);
	return line.slice(name.length + 1).replaceAll('"', "");
}

const viteHosts = ["react-router", "tanstack-start"] as const;

const selfHost: ForgeConfig = {
	slug: "acme",
	authentication: "better-auth",
	authMethods: ["email-password"],
	backend: "self",
	packageManager: "pnpm",
};

const nativeDrivers: ReadonlyArray<{
	readonly orm: "drizzle" | "prisma";
	readonly databaseProvider?: "turso";
	readonly driver: string;
}> = [
	{ orm: "drizzle", driver: "@libsql/client" },
	{ orm: "drizzle", databaseProvider: "turso", driver: "@libsql/client" },
	{ orm: "prisma", driver: "@prisma/adapter-better-sqlite3" },
	{
		orm: "prisma",
		databaseProvider: "turso",
		driver: "@prisma/adapter-libsql",
	},
];

describe("self hosted Vite database drivers", () => {
	it.each(
		viteHosts.flatMap((web) =>
			nativeDrivers.map((entry) => ({ ...entry, web })),
		),
	)(
		"declares $driver on a self hosted $web app ($orm, $databaseProvider)",
		async ({ web, orm, databaseProvider, driver }) => {
			const plan = await plannedProject({
				...selfHost,
				web,
				orm,
				database: "sqlite",
				...(databaseProvider === undefined ? {} : { databaseProvider }),
			});

			const db = packageJsonAt(plan, "packages/db/package.json");
			const app = packageJsonAt(plan, "apps/web/package.json");

			expect(db.dependencies?.[driver]).toBe("catalog:");
			expect(app.dependencies?.[driver]).toBe(db.dependencies?.[driver]);
		},
	);

	it.each<{
		readonly name: string;
		readonly config: ForgeConfig;
		readonly driver: string;
	}>([
		{
			name: "a postgres React Router self host",
			config: {
				...selfHost,
				web: "react-router",
				orm: "drizzle",
				database: "postgresql",
			},
			driver: "pg",
		},
		{
			name: "a mysql TanStack Start self host",
			config: {
				...selfHost,
				web: "tanstack-start",
				orm: "prisma",
				database: "mysql",
			},
			driver: "@prisma/adapter-mariadb",
		},
		{
			name: "a Next.js self host",
			config: {
				...selfHost,
				web: "nextjs",
				orm: "drizzle",
				database: "sqlite",
			},
			driver: "@libsql/client",
		},
		{
			name: "a TanStack Start client of Hono",
			config: {
				...selfHost,
				backend: "hono",
				web: "tanstack-start",
				orm: "drizzle",
				database: "sqlite",
			},
			driver: "@libsql/client",
		},
	])(
		"keeps $driver on the db package only for $name",
		async ({ config, driver }) => {
			const plan = await plannedProject(config);

			expect(
				packageJsonAt(plan, "packages/db/package.json").dependencies,
			).toHaveProperty(driver);

			expect(
				packageJsonAt(plan, "apps/web/package.json").dependencies,
			).not.toHaveProperty(driver);
		},
	);

	it("keeps the driver off secondary Vite apps", async () => {
		const plan = await plannedProject({
			...selfHost,
			web: "tanstack-start",
			orm: "drizzle",
			database: "sqlite",
			webApps: [{ name: "admin", framework: "react-router", client: true }],
		});

		expect(
			packageJsonAt(plan, "apps/admin/package.json").dependencies,
		).not.toHaveProperty("@libsql/client");
	});
});

const startScripts = {
	"react-router":
		"dotenv -e .env.production -e ../../.env -v NODE_ENV=production -- react-router-serve ./build/server/index.js",
	"tanstack-start":
		"dotenv -e .env.production -e ../../.env -v NODE_ENV=production -- srvx --prod -s ../client dist/server/server.js",
} as const;

function productionPort(plan: Plan, app: string): number {
	const content = writeContent(plan, `apps/${app}/.env.production`);
	const port = /^PORT=(\d+)\n$/.exec(content)?.[1];
	if (port === undefined) throw new Error(`Missing Production Port: ${app}`);
	return Number(port);
}

describe("self hosted Vite production start", () => {
	it.each(viteHosts)(
		"serves a %s primary on the port its origin names",
		async (web) => {
			const plan = await plannedProject({
				...selfHost,
				web,
				orm: "drizzle",
				database: "sqlite",
			});

			expect(packageJsonAt(plan, "apps/web/package.json").scripts?.start).toBe(
				startScripts[web],
			);

			expect(productionPort(plan, "web")).toBe(
				Number(new URL(envValue(plan, "APP_ORIGIN")).port),
			);
		},
	);
});

describe("secondary Vite production start", () => {
	it.each(viteHosts)(
		"serves a %s secondary on its dev port",
		async (framework) => {
			const plan = await plannedProject({
				slug: "acme",
				web: "nextjs",
				webApps: [{ name: "admin", framework }],
			});

			const scripts = packageJsonAt(plan, "apps/admin/package.json").scripts;
			const devPort = /--port (\d+)/.exec(scripts?.dev ?? "")?.[1];
			if (devPort === undefined)
				throw new Error(`Missing Secondary Dev Port: ${framework}`);

			expect(scripts?.start).toBe(startScripts[framework]);
			expect(productionPort(plan, "admin")).toBe(Number(devPort));
		},
	);

	it("lets a platform PORT through every Vite start", async () => {
		const plan = await plannedProject({
			...selfHost,
			web: "react-router",
			orm: "drizzle",
			database: "sqlite",
			webApps: [
				{ name: "admin", framework: "tanstack-start", client: true },
				{ name: "docs", framework: "react-router" },
			],
		});

		for (const app of ["web", "admin", "docs"]) {
			const start = packageJsonAt(plan, `apps/${app}/package.json`).scripts
				?.start;

			expect(start, app).toBeDefined();
			expect(start, app).not.toContain("-v PORT");
		}
	});

	it("keeps .env.production out of the generated gitignore", async () => {
		const plan = await plannedProject({
			...selfHost,
			web: "tanstack-start",
			orm: "drizzle",
			database: "sqlite",
		});
		const ignored = writeContent(plan, ".gitignore").split("\n");

		expect(ignored).not.toContain(".env.production");
		expect(ignored).not.toContain(".env.*");
		expect(ignored).not.toContain("*.production");
	});
});
