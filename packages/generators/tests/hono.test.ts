import { describe, expect, it } from "vitest";
import {
	apiHostError,
	backends,
	builtins,
	honoFramework,
	resolveApiHost,
} from "../src";
import { readTemplate } from "../src/template";
import { plannedProject } from "./planner-harness";

const markerPattern = /__[A-Z_]+__/;

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

function expectedHonoApp(usesTrpc: boolean, usesAuth: boolean) {
	return [
		'import { Hono } from "hono";\n',
		usesAuth ? 'import { authRoutes } from "./routes/auth.js";\n' : "",
		usesTrpc ? 'import { trpcRoutes } from "./routes/trpc.js";\n' : "",
		"\nexport const app = new Hono();\n\n",
		'app.get("/", (c) => c.json({ ok: true }));\n\n',
		usesTrpc ? 'app.route("/", trpcRoutes);\n' : "",
		usesAuth ? 'app.route("/", authRoutes);\n' : "",
	].join("");
}

function expectedTrpcClient(options: {
	readonly standalone: boolean;
	readonly variant: "rsc" | "vite";
}) {
	const template =
		options.variant === "rsc"
			? "api/trpc/rsc/react.tsx"
			: "api/trpc/vite/react.tsx";
	const serverUrl =
		options.variant === "rsc"
			? "env.NEXT_PUBLIC_SERVER_URL"
			: "env.VITE_SERVER_URL";

	return readTemplate(template)
		.replaceAll("__SLUG__", "acme")
		.replace(
			"// __ENV_IMPORT__\n",
			options.standalone
				? options.variant === "rsc"
					? 'import { env } from "../env";\n'
					: 'import { env } from "../../env";\n'
				: "",
		)
		.replace(
			"__API_URL__",
			options.standalone ? `\`\${${serverUrl}}/api/trpc\`` : '"/api/trpc"',
		)
		.replace(
			"          // __CREDENTIAL_FETCH__\n",
			options.standalone
				? '          fetch(url, options) {\n            return globalThis.fetch(url, {\n              ...options,\n              credentials: "include",\n            });\n          },\n'
				: "",
		);
}

function expectedAuthClient(options: {
	readonly standalone: boolean;
	readonly variant: "nextjs" | "vite";
}) {
	const envTypes =
		options.standalone && options.variant === "vite"
			? "\ndeclare global {\n  interface ImportMetaEnv {\n    readonly VITE_SERVER_URL: string;\n  }\n\n  interface ImportMeta {\n    readonly env: ImportMetaEnv;\n  }\n}\n"
			: "";
	const declaration =
		"export const authClient: ReturnType<typeof createAuthClient> =\n  createAuthClient(__CLIENT_OPTIONS__);\n";
	const rendered = options.standalone
		? `export const authClient: ReturnType<typeof createAuthClient> = createAuthClient(\n  {\n    baseURL: ${options.variant === "nextjs" ? "process.env.NEXT_PUBLIC_SERVER_URL" : "import.meta.env.VITE_SERVER_URL"},\n    fetchOptions: { credentials: "include" },\n  },\n);\n`
		: "export const authClient: ReturnType<typeof createAuthClient> =\n  createAuthClient();\n";

	return readTemplate("auth/better-auth/packages/auth/src/client.ts")
		.replace("// __CLIENT_ENV_TYPES__\n", envTypes)
		.replace(declaration, rendered);
}

describe("Hono backend", () => {
	it("normalizes legacy backend vocabulary and exposes Hono", () => {
		expect(backends.normalize("nextjs")).toBe("self");
		expect(backends.normalize("Next.js")).toBe("self");
		expect(backends.normalize("hono")).toBe("hono");
		expect(backends.available("hono")).toBe(true);
	});

	it("resolves standalone and self-hosted API hosts", () => {
		expect(
			resolveApiHost(
				{ backend: "hono", web: "tanstack-router" },
				builtins.frameworks,
			),
		).toBe("server");
		expect(
			resolveApiHost({ backend: "self", web: "nextjs" }, builtins.frameworks),
		).toBe("web");

		expect(
			resolveApiHost(
				{ backend: "self", web: "tanstack-router" },
				builtins.frameworks,
			),
		).toBeUndefined();
		expect(
			resolveApiHost({ backend: "convex", web: "nextjs" }, builtins.frameworks),
		).toBeUndefined();
	});

	it("names the addon and framework when no host can serve it", () => {
		const config = { backend: "self", web: "tanstack-router" } as const;

		expect(
			apiHostError(config, { id: "trpc", name: "tRPC" }, builtins.frameworks)
				?.message,
		).toBe(
			"tRPC needs a backend. TanStack Router can't host it; add a backend framework.",
		);
		expect(
			apiHostError(
				config,
				{ id: "better-auth", name: "Better Auth" },
				builtins.frameworks,
			)?.message,
		).toBe(
			"Better Auth needs a backend. TanStack Router can't host it; add a backend framework.",
		);
		expect(
			apiHostError({}, { id: "trpc", name: "tRPC" }, builtins.frameworks),
		).toBeUndefined();
		expect(
			apiHostError(
				{ backend: "convex" },
				{ id: "trpc", name: "tRPC" },
				builtins.frameworks,
			)?.message,
		).toBe(
			"tRPC needs a backend. The selected web framework can't host it; add a backend framework.",
		);
	});

	it("declares the standalone server contract without a config file", () => {
		expect(honoFramework).toMatchObject({
			buildOutputs: ["dist/**"],
			ignoreDirs: [],
			slots: ["api", "trpc", "auth"],
			sourceRoot: "src",
			tsconfigPreset: { name: "hono" },
		});
		expect(honoFramework).not.toHaveProperty("configFile");
	});

	it("renders validated server startup and graceful shutdown", async () => {
		const plan = await plannedProject({
			backend: "hono",
			catalogs: "scoped",
			name: "Acme",
			packageManager: "pnpm",
			platforms: [],
			runtime: "Node.js",
			slug: "acme",
		});

		const env = writeContent(plan, "apps/server/env.ts");
		expect(env).toContain(
			"PORT: z.coerce.number().int().positive().default(3001)",
		);

		const entry = writeContent(plan, "apps/server/src/index.ts");
		expect(entry).toContain("const server = serve(");
		expect(entry).toContain("server.close(() => process.exit(0))");
		expect(entry).toContain('process.on("SIGINT", shutdown)');
		expect(entry).toContain('process.on("SIGTERM", shutdown)');
	});

	it.each([
		[false, false],
		[true, false],
		[false, true],
		[true, true],
	] as const)(
		"renders exact Hono app registration for trpc=%s auth=%s",
		async (usesTrpc, usesAuth) => {
			const plan = await plannedProject({
				...(usesAuth
					? {
							authentication: "better-auth" as const,
							database: "sqlite" as const,
							orm: "drizzle" as const,
						}
					: {}),
				backend: "hono",
				catalogs: "scoped",
				name: "Acme",
				packageManager: "pnpm",
				platforms: ["web"],
				...(usesTrpc ? { rpc: "trpc" as const } : {}),
				runtime: "Node.js",
				slug: "acme",
				web: "nextjs",
			});
			const app = writeContent(plan, "apps/server/src/app.ts");
			expect(app).toBe(expectedHonoApp(usesTrpc, usesAuth));
			expect(app).not.toMatch(markerPattern);
		},
	);

	it.each([
		["nextjs", "http://localhost:3000", "NEXT_PUBLIC_SERVER_URL"],
		["react-router", "http://localhost:5173", "VITE_SERVER_URL"],
		["tanstack-router", "http://localhost:3000", "VITE_SERVER_URL"],
		["tanstack-start", "http://localhost:3000", "VITE_SERVER_URL"],
	] as const)(
		"uses the %s development origin",
		async (web, origin, serverUrl) => {
			const plan = await plannedProject({
				backend: "hono",
				catalogs: "scoped",
				name: "Acme",
				packageManager: "pnpm",
				platforms: ["web"],
				runtime: "Node.js",
				slug: "acme",
				web,
			});
			const expected = `WEB_URL="${origin}"`;
			expect(writeContent(plan, ".env")).toContain(expected);
			expect(writeContent(plan, ".env.example")).toContain(expected);
			expect(writeContent(plan, "apps/server/env.ts")).toContain(
				`WEB_URL: z.url().default("${origin}")`,
			);
			expect(writeContent(plan, "apps/server/env.ts")).not.toMatch(
				markerPattern,
			);
			const webEnv = writeContent(plan, "apps/web/env.ts");
			expect(webEnv).toContain(
				`${serverUrl}: z.url().default("http://localhost:3001")`,
			);
			expect(webEnv).not.toMatch(markerPattern);
		},
	);

	it("adds the credential password field to the Prisma account model", async () => {
		const plan = await plannedProject({
			authentication: "better-auth",
			backend: "hono",
			catalogs: "scoped",
			database: "sqlite",
			name: "Acme",
			orm: "prisma",
			packageManager: "pnpm",
			platforms: ["web"],
			runtime: "Node.js",
			slug: "acme",
			web: "tanstack-router",
		});

		const schema = writeContent(plan, "packages/db/prisma/schema.prisma");
		expect(schema).toContain("password              String?");
		expect(schema).not.toMatch(markerPattern);
	});

	it.each([
		["nextjs", "self", "rsc", "trpc/react.tsx", "nextjs"],
		["nextjs", "hono", "rsc", "trpc/react.tsx", "nextjs"],
		["react-router", "self", "vite", "app/trpc/react.tsx", "vite"],
		["tanstack-router", "hono", "vite", "src/trpc/react.tsx", "vite"],
	] as const)(
		"renders exact %s %s tRPC and auth clients",
		async (web, backend, variant, trpcPath, authVariant) => {
			const plan = await plannedProject({
				authentication: "better-auth",
				backend,
				catalogs: "scoped",
				database: "sqlite",
				name: "Acme",
				orm: "drizzle",
				packageManager: "pnpm",
				platforms: ["web"],
				rpc: "trpc",
				runtime: "Node.js",
				slug: "acme",
				web,
			});
			const standalone = backend === "hono";
			const trpcClient = writeContent(plan, `apps/web/${trpcPath}`);
			const authClient = writeContent(plan, "packages/auth/src/client.ts");
			expect(trpcClient).toBe(expectedTrpcClient({ standalone, variant }));
			expect(authClient).toBe(
				expectedAuthClient({ standalone, variant: authVariant }),
			);
			expect(trpcClient).not.toMatch(markerPattern);
			expect(authClient).not.toMatch(markerPattern);
		},
	);

	it("plans the SPA, server, tRPC, and Better Auth without phantom web installs", async () => {
		const plan = await plannedProject({
			authentication: "better-auth",
			backend: "hono",
			catalogs: "scoped",
			database: "sqlite",
			name: "Acme",
			orm: "drizzle",
			packageManager: "pnpm",
			platforms: ["web"],
			rpc: "trpc",
			runtime: "Node.js",
			slug: "acme",
			web: "tanstack-router",
		});

		const serverEntry = Object.entries(plan.manifest.modules).find(
			([, module]) => module.root === "apps/server",
		);
		const server = serverEntry?.[1];
		const serverId = serverEntry?.[0];
		expect(server).toMatchObject({ root: "apps/server" });
		const marker = plan.writes.find(
			(write) => write.path === "apps/server/forge.json",
		);
		expect(marker?.content).toContain('"framework": "hono"');
		expect(marker?.content).toContain('"trpc": "src/routes/trpc.ts"');
		expect(marker?.content).toContain('"auth": "src/routes/auth.ts"');
		expect(plan.writes.map((write) => write.path)).toEqual(
			expect.arrayContaining([
				"apps/web/src/trpc/query-client.ts",
				"apps/web/src/trpc/react.tsx",
				"apps/server/src/app.ts",
				"apps/server/src/routes/auth.ts",
				"apps/server/src/routes/trpc.ts",
				"apps/server/tsdown.config.ts",
				"packages/auth/src/index.ts",
			]),
		);
		expect(plan.writes.map((write) => write.path)).not.toContain(
			"apps/web/src/trpc/server.ts",
		);
		const trpcClient = plan.writes.find(
			(write) => write.path === "apps/web/src/trpc/react.tsx",
		);
		expect(trpcClient?.content).toContain('credentials: "include"');
		const authClient = plan.writes.find(
			(write) => write.path === "packages/auth/src/client.ts",
		);
		expect(authClient?.content).toContain("import.meta.env.VITE_SERVER_URL");
		expect(authClient?.content).toContain('credentials: "include"');
		const authIndex = plan.writes.find(
			(write) => write.path === "packages/auth/src/index.ts",
		);
		expect(authIndex?.content).toContain("trustedOrigins: [env.WEB_URL]");
		expect(authIndex?.content).toContain("emailAndPassword: { enabled: true }");
		expect(writeContent(plan, ".env")).toContain(
			'APP_ORIGIN="http://localhost:3001"',
		);
		const authSchema = plan.writes.find(
			(write) => write.path === "packages/db/src/schema/auth.ts",
		);
		expect(authSchema?.content).toContain("password: text()");
		expect(authSchema?.content).not.toMatch(markerPattern);
		const authEnv = plan.writes.find(
			(write) => write.path === "packages/auth/env.ts",
		);
		expect(authEnv?.content).toContain("WEB_URL: z.url()");
		const trpcRoute = plan.writes.find(
			(write) => write.path === "apps/server/src/routes/trpc.ts",
		);
		expect(trpcRoute?.content).toContain('import { cors } from "hono/cors"');
		expect(trpcRoute?.content).toContain('"x-trpc-source"');
		expect(trpcRoute?.content).toContain("credentials: true");
		for (const id of ["trpc", "better-auth"]) {
			const install = plan.manifest.installs.find(
				(entry) => entry.definitionId === id,
			);
			expect(install?.targets).toEqual(
				serverId ? [{ kind: "module", moduleId: serverId }] : [],
			);
		}
	});

	it("does not ensure web dependencies for a backend-only project", async () => {
		const plan = await plannedProject({
			authentication: "better-auth",
			backend: "hono",
			catalogs: "scoped",
			database: "sqlite",
			name: "Acme",
			orm: "drizzle",
			packageManager: "pnpm",
			platforms: [],
			rpc: "trpc",
			runtime: "Node.js",
			slug: "acme",
		});

		expect(
			plan.writes.some((write) => write.path.startsWith("apps/web/")),
		).toBe(false);
		expect(
			Object.values(plan.manifest.modules).some(
				(module) => module.root === "apps/web",
			),
		).toBe(false);
	});
});
