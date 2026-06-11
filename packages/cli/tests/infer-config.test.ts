import { join } from "node:path";
import type { DiscoveredModule } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import { inferConfigSnapshot } from "../src/commands/infer-config";
import {
	appModule,
	withTempDir,
	writeJson,
	writeText,
} from "./lifecycle-fixtures";

const uiModule: DiscoveredModule = {
	capabilities: ["react", "ui", "tailwind"],
	id: "fghij",
	packageName: "@acme/ui",
	packageType: "library",
	root: "packages/ui",
	slots: {},
	template: { id: "ui", version: 1 },
	type: "package",
};

const dbModule: DiscoveredModule = {
	capabilities: [],
	id: "klmno",
	packageName: "@acme/db",
	packageType: "library",
	root: "packages/db",
	slots: {},
	template: { id: "db", version: 1 },
	type: "package",
};

describe("inferConfigSnapshot", () => {
	it("returns the default snapshot for a bare directory", async () => {
		await withTempDir("infer-bare", async (directory) => {
			const config = await inferConfigSnapshot(directory, []);

			expect(config).toStrictEqual({
				addons: [],
				authentication: undefined,
				database: undefined,
				databaseProvider: undefined,
				linter: undefined,
				name: "my-app",
				orm: undefined,
				packageManager: "pnpm",
				path: directory,
				rpc: undefined,
				runtime: "Node.js",
				slug: "my-app",
				style: undefined,
				web: undefined,
			});
		});
	});

	it("strips the scope from a scoped package name", async () => {
		await withTempDir("infer-slug", async (directory) => {
			await writeJson(join(directory, "package.json"), { name: "@acme/app" });

			const config = await inferConfigSnapshot(directory, []);

			expect(config.slug).toBe("app");
			expect(config.name).toBe("app");
		});
	});

	it("keeps an unscoped package name as the slug", async () => {
		await withTempDir("infer-slug-plain", async (directory) => {
			await writeJson(join(directory, "package.json"), { name: "acme" });

			const config = await inferConfigSnapshot(directory, []);

			expect(config.slug).toBe("acme");
		});
	});

	it("infers the runtime from the package.json engines field", async () => {
		const cases = [
			[{ node: "22" }, "Node.js"],
			[{ bun: "1.2.19" }, "Bun"],
			[{ deno: "2.3.1" }, "Deno"],
			[{ bun: "1.2.19", node: "22" }, "Node.js"],
		] as const;

		for (const [engines, runtime] of cases)
			await withTempDir("infer-runtime", async (directory) => {
				await writeJson(join(directory, "package.json"), { engines });

				const config = await inferConfigSnapshot(directory, []);

				expect(config.runtime).toBe(runtime);
			});
	});

	it("parses the packageManager prefix and falls back to pnpm", async () => {
		const cases = [
			["yarn@4.1.0", "Yarn"],
			["npm@10.9.0", "npm"],
			["bun@1.2.19", "Bun"],
			["moon@1.0.0", "pnpm"],
		] as const;

		for (const [packageManager, displayName] of cases)
			await withTempDir("infer-pm", async (directory) => {
				await writeJson(join(directory, "package.json"), { packageManager });

				const config = await inferConfigSnapshot(directory, []);

				expect(config.packageManager).toBe(displayName);
			});
	});

	it("detects the web framework from the app module", async () => {
		await withTempDir("infer-web", async (directory) => {
			const config = await inferConfigSnapshot(directory, [appModule]);

			expect(config.web).toBe("nextjs");
			expect(config.rpc).toBeUndefined();
			expect(config.authentication).toBeUndefined();
		});
	});

	it("detects tailwind from the ui module capabilities", async () => {
		await withTempDir("infer-style", async (directory) => {
			const config = await inferConfigSnapshot(directory, [uiModule]);

			expect(config.style).toBe("tailwind");
		});
	});

	it("leaves style unset when the ui module lacks the tailwind capability", async () => {
		await withTempDir("infer-style-css", async (directory) => {
			const config = await inferConfigSnapshot(directory, [
				{ ...uiModule, capabilities: ["react", "ui", "css"] },
			]);

			expect(config.style).toBeUndefined();
		});
	});

	it("detects trpc from the web module marker file", async () => {
		await withTempDir("infer-trpc", async (directory) => {
			await writeText(
				join(directory, "apps/web/src/trpc/index.ts"),
				"export {};\n",
			);

			const config = await inferConfigSnapshot(directory, [appModule]);

			expect(config.rpc).toBe("trpc");
		});
	});

	it("detects the orm from db module marker files", async () => {
		const cases = [
			[["drizzle.config.ts"], "drizzle"],
			[["prisma.config.ts"], "prisma"],
			[["drizzle.config.ts", "prisma.config.ts"], "drizzle"],
		] as const;

		for (const [markers, orm] of cases)
			await withTempDir("infer-orm", async (directory) => {
				for (const marker of markers)
					await writeText(
						join(directory, "packages/db", marker),
						"export default {};\n",
					);

				const config = await inferConfigSnapshot(directory, [dbModule]);

				expect(config.orm).toBe(orm);
			});
	});

	it("detects better-auth through the auth slot", async () => {
		await withTempDir("infer-auth-slot", async (directory) => {
			await writeText(
				join(directory, "apps/web/src/server/auth.ts"),
				"export {};\n",
			);

			const config = await inferConfigSnapshot(directory, [
				{ ...appModule, slots: { auth: "src/server/auth.ts" } },
			]);

			expect(config.authentication).toBe("better-auth");
		});
	});

	it("falls back to src/lib/auth.ts when the auth slot is missing", async () => {
		await withTempDir("infer-auth-fallback", async (directory) => {
			await writeText(
				join(directory, "apps/web/src/lib/auth.ts"),
				"export {};\n",
			);

			const config = await inferConfigSnapshot(directory, [appModule]);

			expect(config.authentication).toBe("better-auth");
		});
	});

	it("detects biome from biome.json", async () => {
		await withTempDir("infer-linter", async (directory) => {
			await writeText(join(directory, "biome.json"), "{}\n");

			const config = await inferConfigSnapshot(directory, []);

			expect(config.linter).toBe("biome");
		});
	});

	it("reads database evidence from the db package and a quoted env value", async () => {
		await withTempDir("infer-db", async (directory) => {
			await writeText(
				join(directory, "packages/db/drizzle.config.ts"),
				"export default {};\n",
			);
			await writeJson(join(directory, "packages/db/package.json"), {
				dependencies: { postgres: "^3.4.0" },
				name: "@acme/db",
			});
			await writeText(
				join(directory, ".env"),
				'DATABASE_URL="postgres://postgres.ref:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"\n',
			);

			const config = await inferConfigSnapshot(directory, [dbModule]);

			expect(config.database).toBe("postgresql");
			expect(config.databaseProvider).toBe("supabase");
		});
	});

	it("parses env values from a file with CRLF line endings", async () => {
		await withTempDir("infer-crlf", async (directory) => {
			await writeText(
				join(directory, "packages/db/drizzle.config.ts"),
				"export default {};\n",
			);
			await writeJson(join(directory, "packages/db/package.json"), {
				dependencies: { "@libsql/client": "^0.14.0" },
				name: "@acme/db",
			});
			await writeText(
				join(directory, ".env"),
				"TURSO_DATABASE_URL='libsql://acme-org.turso.io'\r\nTURSO_AUTH_TOKEN='token'\r\n",
			);

			const config = await inferConfigSnapshot(directory, [dbModule]);

			expect(config.database).toBe("sqlite");
			expect(config.databaseProvider).toBe("turso");
		});
	});

	it("falls back to TURSO_DATABASE_URL when DATABASE_URL is missing", async () => {
		await withTempDir("infer-turso", async (directory) => {
			await writeText(
				join(directory, "packages/db/drizzle.config.ts"),
				"export default {};\n",
			);
			await writeJson(join(directory, "packages/db/package.json"), {
				dependencies: { "@libsql/client": "^0.14.0" },
				name: "@acme/db",
			});
			await writeText(
				join(directory, ".env"),
				"TURSO_DATABASE_URL='libsql://acme-org.turso.io'\nTURSO_AUTH_TOKEN='token'\n",
			);

			const config = await inferConfigSnapshot(directory, [dbModule]);

			expect(config.database).toBe("sqlite");
			expect(config.databaseProvider).toBe("turso");
		});
	});

	it("skips database evidence when no orm marker exists", async () => {
		await withTempDir("infer-db-skip", async (directory) => {
			await writeJson(join(directory, "packages/db/package.json"), {
				dependencies: { mysql2: "^3.11.0" },
				name: "@acme/db",
			});
			await writeText(
				join(directory, ".env"),
				'DATABASE_URL="mysql://root:password@localhost:3306/app"\n',
			);

			const config = await inferConfigSnapshot(directory, [dbModule]);

			expect(config.orm).toBeUndefined();
			expect(config.database).toBeUndefined();
			expect(config.databaseProvider).toBeUndefined();
		});
	});

	it("detects every opt-in addon from its marker file", async () => {
		await withTempDir("infer-addons", async (directory) => {
			await writeText(
				join(directory, "commitlint.config.ts"),
				"export default {};\n",
			);
			await writeText(
				join(directory, ".github/workflows/ci.yml"),
				"name: CI\n",
			);
			await writeText(join(directory, "lefthook.yml"), "pre-commit:\n");
			await writeJson(join(directory, "packages/shared/package.json"), {
				name: "@acme/shared",
			});
			await writeText(join(directory, ".vscode/settings.json"), "{}\n");

			const config = await inferConfigSnapshot(directory, []);

			expect(config.addons).toEqual([
				"commitlint",
				"github-ci",
				"lefthook",
				"shared",
				"vscode",
			]);
		});
	});
});
