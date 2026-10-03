import { createHash } from "node:crypto";
import type { ProjectPlan } from "@ryuugg/core";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	type ForgeConfig,
	reservedWebAppNames,
	webAppInstances,
	webFrameworks,
} from "../src";
import { plannedProject } from "./planner-harness";

const appPackageSchema = Schema.fromJsonString(
	Schema.Struct({
		name: Schema.String,
		dependencies: Schema.Record(Schema.String, Schema.String),
		scripts: Schema.Struct({ dev: Schema.String }),
	}),
);

function contentAt(plan: ProjectPlan, path: string): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Planned File: ${path}`);
	return write.content;
}

function stablePlan(plan: ProjectPlan): string {
	const moduleRoots = Object.entries(plan.manifest.modules).map(
		([id, module]) => {
			if (module.root === undefined)
				throw new Error(`Missing Module Root: ${id}`);

			return { id, root: module.root };
		},
	);

	let serialized = JSON.stringify({
		writes: plan.writes.map(({ path, content }) => ({ path, content })),
		manifest: { ...plan.manifest, config: {} },
		lockfile: plan.lockfile,
	});

	for (const { id, root } of moduleRoots)
		serialized = serialized.replaceAll(id, root);

	for (const write of plan.writes.filter((entry) =>
		entry.path.endsWith("/forge.json"),
	)) {
		let content = write.content;
		for (const { id, root } of moduleRoots)
			content = content.replaceAll(id, root);

		serialized = serialized.replaceAll(
			createHash("sha256").update(write.content).digest("hex"),
			createHash("sha256").update(content).digest("hex"),
		);
	}

	return serialized;
}

describe("webAppInstances", () => {
	it("has no instances without a primary web framework", () => {
		expect(webAppInstances({})).toEqual([]);
		expect(
			webAppInstances({
				webApps: [{ name: "admin", framework: "nextjs" }],
			}),
		).toEqual([]);
	});

	it("keeps the primary unmarked without secondary apps", () => {
		for (const webApps of [undefined, []]) {
			const instances = webAppInstances({ web: "nextjs", webApps });

			expect(instances).toEqual([
				{
					key: "web",
					root: "apps/web",
					packageName: "@my-app/web",
					framework: "nextjs",
					port: 3000,
					primary: true,
				},
			]);

			expect(instances[0]).not.toHaveProperty("role");
		}
	});

	it("allocates ordered instances without using the backend port", () => {
		for (const backend of [undefined, "hono"] as const) {
			const instances = webAppInstances({
				slug: "acme",
				web: "tanstack-router",
				backend,
				webApps: [
					{ name: "admin", framework: "tanstack-router" },
					{ name: "docs", framework: "tanstack-router" },
				],
			});

			expect(instances).toEqual([
				{
					key: "web",
					root: "apps/web",
					packageName: "@acme/web",
					framework: "tanstack-router",
					port: 3000,
					primary: true,
					role: "primary",
				},
				{
					key: "admin",
					root: "apps/admin",
					packageName: "@acme/admin",
					framework: "tanstack-router",
					port: 3002,
					primary: false,
				},
				{
					key: "docs",
					root: "apps/docs",
					packageName: "@acme/docs",
					framework: "tanstack-router",
					port: 3003,
					primary: false,
				},
			]);
		}
	});

	it("allocates React Router ports above 5173", () => {
		expect(
			webAppInstances({
				web: "react-router",
				webApps: [{ name: "admin", framework: "react-router" }],
			}).map((instance) => instance.port),
		).toEqual([5173, 5174]);
	});

	it("reserves every generated app and package name", () => {
		expect(reservedWebAppNames).toEqual([
			"web",
			"server",
			"mobile",
			"desktop",
			"worker",
			"auth",
			"db",
			"ui",
			"trpc",
			"orpc",
			"email",
			"shared",
			"tsconfig",
			"github",
		]);
	});
});

describe("secondary web app planning", () => {
	it.each([
		...webFrameworks.ids.map((web) => ({ web, backend: "hono" as const })),
		...(["nextjs", "react-router", "tanstack-start"] as const).map((web) => ({
			web,
			backend: "self" as const,
		})),
	])(
		"keeps $web secondary apps free of API wiring with backend $backend",
		async ({ web, backend }) => {
			const config: ForgeConfig = {
				name: "Acme",
				slug: "acme",
				web,
				backend,
				rpc: "trpc",
				authentication: "better-auth",
				orm: "drizzle",
				database: "sqlite",
				style: "tailwind",
				linter: "biome",
				packageManager: "pnpm",
				webApps: [{ name: "admin", framework: web }],
			};

			const plan = await plannedProject(config);
			const admin = Schema.decodeSync(appPackageSchema)(
				contentAt(plan, "apps/admin/package.json"),
			);

			const primary = Schema.decodeSync(appPackageSchema)(
				contentAt(plan, "apps/web/package.json"),
			);

			expect(admin.name).toBe("@acme/admin");
			expect(admin.scripts.dev).toContain(
				`--port ${web === "react-router" ? 5174 : 3002}`,
			);

			expect(admin.dependencies).toHaveProperty("@acme/ui", "workspace:*");

			for (const name of ["@acme/trpc", "@acme/auth", "@acme/db"])
				expect(admin.dependencies).not.toHaveProperty(name);

			expect(primary.dependencies).toHaveProperty("@acme/trpc");
			expect(contentAt(plan, "apps/web/forge.json")).toContain(
				'"role": "primary"',
			);

			expect(contentAt(plan, "apps/admin/forge.json")).not.toContain('"role"');
			expect(
				plan.writes
					.map((write) => write.path)
					.filter(
						(path) =>
							path.startsWith("apps/admin/") && /trpc|auth|api/.test(path),
					),
			).toEqual([]);

			expect(
				plan.writes.some(
					(write) =>
						write.path.startsWith("apps/web/") && write.path.includes("trpc"),
				),
			).toBe(true);

			expect(contentAt(plan, "apps/admin/env.ts")).not.toContain("SERVER_URL");
			const sourceRoot =
				web === "nextjs" ? "app" : web === "react-router" ? "app" : "src";

			expect(
				contentAt(plan, `apps/admin/${sourceRoot}/providers.tsx`),
			).not.toContain("TRPC");

			expect(contentAt(plan, "apps/admin/forge.json")).not.toMatch(
				/"(?:api|auth|trpc)":/,
			);

			if (web === "nextjs") {
				const nextConfig = contentAt(plan, "apps/admin/next.config.ts");
				expect(nextConfig).toContain('transpilePackages: ["@acme/ui"]');
			}

			if (web === "react-router")
				expect(contentAt(plan, "apps/admin/app/routes.ts")).not.toContain(
					"api/",
				);
		},
	);

	it.each(webFrameworks.ids)(
		"treats an empty secondary list identically for %s",
		async (web) => {
			const config: ForgeConfig = {
				slug: "acme",
				web,
				backend: "hono",
				rpc: "trpc",
			};

			const original = await plannedProject(config);
			const empty = await plannedProject({ ...config, webApps: [] });

			expect(stablePlan(empty)).toBe(stablePlan(original));
			const primary = Schema.decodeSync(appPackageSchema)(
				contentAt(original, "apps/web/package.json"),
			);

			const command =
				web === "nextjs"
					? "next dev"
					: web === "react-router"
						? "react-router dev"
						: "vite dev --port 3000";

			expect(primary.scripts.dev).toBe(`pnpm with-env ${command}`);
			expect(contentAt(original, "apps/web/forge.json")).not.toContain(
				'"role"',
			);
		},
	);
});
