import { GeneratorError } from "@ryuujs/core";
import { describe, expect, it } from "vitest";
import { expoFramework, type ForgeConfig } from "../src";
import { expoScheme } from "../src/frameworks/expo";
import { readTemplate } from "../src/template";
import { plannedProject } from "./planner-harness";

const markerPattern = /__[A-Z_]+__/;

function mobileConfig(overrides: ForgeConfig = {}): ForgeConfig {
	return {
		backend: "hono",
		catalogs: "scoped",
		mobile: "expo",
		name: "Acme",
		packageManager: "pnpm",
		platforms: ["web", "mobile"],
		runtime: "Node.js",
		slug: "acme",
		web: "nextjs",
		...overrides,
	};
}

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

function expectedTrpcClient(usesAuth: boolean) {
	return readTemplate("api/trpc/expo/client.ts")
		.replaceAll("__SLUG__", "acme")
		.replace(
			"// __AUTH_IMPORT__\n",
			usesAuth ? 'import { authClient } from "./auth-client";\n' : "",
		)
		.replace(
			"      // __AUTH_HEADERS__\n",
			usesAuth
				? "      async headers() {\n        const cookies = await authClient.getCookie();\n        return cookies ? { Cookie: cookies } : {};\n      },\n"
				: "",
		);
}

const authOverrides: ForgeConfig = {
	authentication: "better-auth",
	database: "sqlite",
	orm: "drizzle",
};

const trpcOverrides: ForgeConfig = { rpc: "trpc" };

describe("Expo mobile framework", () => {
	it.each([
		["123-acme", "app-123-acme"],
		["Acme_App", "acmeapp"],
	] as const)("derives the Expo scheme for %s", (slug, scheme) => {
		expect(expoScheme(slug)).toBe(scheme);
	});

	it("declares the Expo framework contract", () => {
		expect(expoFramework).toMatchObject({
			buildOutputs: [],
			clientEnvPrefix: "EXPO_PUBLIC_",
			configFile: "app.json",
			ignoreDirs: [".expo/"],
			slots: ["layout", "page"],
			sourceRoot: "src",
			tsconfigPreset: { name: "expo" },
		});
		expect(expoFramework.tsconfigPreset.content).not.toHaveProperty("extends");
	});

	it("renders the Expo app metadata, environment, and layout", async () => {
		const plan = await plannedProject(mobileConfig());
		const packageJson: unknown = JSON.parse(
			writeContent(plan, "apps/mobile/package.json"),
		);
		const tsconfig: unknown = JSON.parse(
			writeContent(plan, "apps/mobile/tsconfig.json"),
		);

		expect(writeContent(plan, "apps/mobile/app.json")).toBe(
			readTemplate("frameworks/expo/app.json")
				.replaceAll("__SCHEME__", "acme")
				.replaceAll("__SLUG__", "acme"),
		);
		expect(packageJson).toMatchObject({
			main: "expo-router/entry",
			name: "@acme/mobile",
			scripts: {
				android: "pnpm with-env expo run:android",
				dev: "pnpm with-env expo start",
				ios: "pnpm with-env expo run:ios",
				typecheck: "tsc --noEmit",
				"with-env": "dotenv -e ../../.env --",
			},
		});
		expect(packageJson).not.toHaveProperty("scripts.build");
		expect(tsconfig).toHaveProperty("extends", [
			"expo/tsconfig.base",
			"@acme/tsconfig/expo.json",
		]);
		expect(writeContent(plan, "apps/mobile/env.ts")).toBe(
			readTemplate("frameworks/expo/env.ts").replaceAll(
				"__SERVER_ORIGIN__",
				"http://localhost:3001",
			),
		);
		expect(writeContent(plan, "apps/mobile/src/app/_layout.tsx")).toBe(
			readTemplate("frameworks/expo/src/app/_layout.tsx"),
		);
	});

	it("uses the self-hosted web origin for the Expo environment", async () => {
		const plan = await plannedProject(
			mobileConfig({ backend: "self", web: "nextjs" }),
		);

		expect(writeContent(plan, "apps/mobile/env.ts")).toContain(
			'z.url().default("http://localhost:3000")',
		);
	});

	it("plans the mobile module, preset, and slot map", async () => {
		const plan = await plannedProject(mobileConfig());
		const mobile = Object.values(plan.manifest.modules).find(
			(module) => module.root === "apps/mobile",
		);

		expect(mobile).toMatchObject({ root: "apps/mobile" });
		const marker = writeContent(plan, "apps/mobile/forge.json");
		expect(marker).toContain('"framework": "expo"');
		expect(marker).toContain('"id": "expo/base"');
		expect(marker).toContain('"layout": "src/app/_layout.tsx"');
		expect(marker).toContain('"page": "src/app/index.tsx"');
		expect(plan.writes.map((write) => write.path)).toEqual(
			expect.arrayContaining([
				"apps/mobile/forge.json",
				"apps/mobile/app.json",
				"apps/mobile/package.json",
				"apps/mobile/tsconfig.json",
				"apps/mobile/env.ts",
				"apps/mobile/src/app/_layout.tsx",
				"apps/mobile/src/app/index.tsx",
				"tooling/tsconfig/expo.json",
			]),
		);
		expect(writeContent(plan, "tooling/tsconfig/expo.json")).not.toContain(
			'"extends"',
		);
	});

	it.each([
		[false, false],
		[true, false],
		[false, true],
		[true, true],
	] as const)(
		"renders mobile clients for trpc=%s auth=%s",
		async (usesTrpc, usesAuth) => {
			const plan = await plannedProject(
				mobileConfig({
					...(usesAuth ? authOverrides : {}),
					...(usesTrpc ? trpcOverrides : {}),
				}),
			);
			const paths = plan.writes.map((write) => write.path);

			expect(paths.includes("apps/mobile/src/lib/trpc.ts")).toBe(usesTrpc);
			expect(paths.includes("apps/mobile/src/lib/auth-client.ts")).toBe(
				usesAuth,
			);
			if (usesTrpc)
				expect(writeContent(plan, "apps/mobile/src/lib/trpc.ts")).toBe(
					expectedTrpcClient(usesAuth),
				);
			if (usesAuth)
				expect(writeContent(plan, "apps/mobile/src/lib/auth-client.ts")).toBe(
					readTemplate("auth/better-auth/expo/auth-client.ts")
						.replaceAll("__SCHEME__", "acme")
						.replaceAll("__SLUG__", "acme"),
				);

			for (const write of plan.writes.filter((entry) =>
				entry.path.startsWith("apps/mobile/"),
			))
				expect(write.content, write.path).not.toMatch(markerPattern);

			expect(
				plan.writes
					.filter(
						(entry) =>
							entry.path.startsWith("apps/mobile/") &&
							entry.content.includes("\t"),
					)
					.map((entry) => entry.path),
			).toEqual([]);
		},
	);

	it("renders self-hosted tRPC and auth mobile clients with dependencies", async () => {
		const plan = await plannedProject(
			mobileConfig({
				...authOverrides,
				...trpcOverrides,
				backend: "self",
				web: "nextjs",
			}),
		);
		const paths = plan.writes.map((write) => write.path);
		const packageJson: unknown = JSON.parse(
			writeContent(plan, "apps/mobile/package.json"),
		);

		expect(
			paths
				.filter(
					(path) =>
						path === "apps/mobile/src/lib/auth-client.ts" ||
						path === "apps/mobile/src/lib/trpc.ts",
				)
				.toSorted(),
		).toEqual([
			"apps/mobile/src/lib/auth-client.ts",
			"apps/mobile/src/lib/trpc.ts",
		]);
		expect(packageJson).toMatchObject({
			dependencies: {
				"@acme/trpc": "workspace:*",
				"@better-auth/expo": expect.any(String),
				"@tanstack/react-query": expect.any(String),
				"@trpc/client": expect.any(String),
				"@trpc/server": expect.any(String),
				"better-auth": expect.any(String),
				"expo-secure-store": expect.any(String),
				superjson: expect.any(String),
			},
		});
	});

	it("uses a valid Expo scheme for digit-leading slugs", async () => {
		const plan = await plannedProject(
			mobileConfig({
				...authOverrides,
				slug: "123-acme",
			}),
		);

		expect(writeContent(plan, "apps/mobile/app.json")).toContain(
			'"scheme": "app-123-acme"',
		);
		expect(writeContent(plan, "packages/auth/src/index.ts")).toContain(
			'"app-123-acme://"',
		);
		expect(writeContent(plan, "apps/mobile/src/lib/auth-client.ts")).toContain(
			'scheme: "app-123-acme"',
		);
	});

	it("plans a mobile-only app without API consumers", async () => {
		const plan = await plannedProject(
			mobileConfig({
				backend: undefined,
				platforms: ["mobile"],
				web: undefined,
			}),
		);

		expect(
			Object.values(plan.manifest.modules).some(
				(module) => module.root === "apps/mobile",
			),
		).toBe(true);
		expect(
			plan.writes.some((write) => write.path.startsWith("apps/web/")),
		).toBe(false);
		expect(
			plan.writes.some((write) => write.path.startsWith("apps/server/")),
		).toBe(false);
	});

	it("rejects a mobile-only tRPC project without an API host", async () => {
		const error = await plannedProject(
			mobileConfig({
				backend: undefined,
				platforms: ["mobile"],
				rpc: "trpc",
				web: undefined,
			}),
		).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(GeneratorError);
		expect(error).toMatchObject({
			generatorId: "trpc",
			reason: "framework-not-supported-yet",
		});
		expect(error).toHaveProperty("message", "tRPC does not support Expo yet.");
	});

	it("adds the Expo environment and gitignore entries once", async () => {
		const plan = await plannedProject(mobileConfig());

		expect(writeContent(plan, ".env")).toContain(
			'# Expo\nEXPO_PUBLIC_SERVER_URL="http://localhost:3001"',
		);
		expect(
			writeContent(plan, ".gitignore")
				.split("\n")
				.filter((line) => line === ".expo/"),
		).toHaveLength(1);
	});

	it("renders the mobile Better Auth server markers", async () => {
		const expoOnly = await plannedProject(
			mobileConfig({
				authentication: "better-auth",
				backend: "self",
				database: "sqlite",
				orm: "drizzle",
				web: "react-router",
			}),
		);
		const expoAndNext = await plannedProject(
			mobileConfig({
				authentication: "better-auth",
				backend: "self",
				database: "sqlite",
				orm: "drizzle",
				web: "nextjs",
			}),
		);
		const standalone = await plannedProject(
			mobileConfig({
				authentication: "better-auth",
				database: "sqlite",
				orm: "drizzle",
			}),
		);

		const expoOnlyIndex = writeContent(expoOnly, "packages/auth/src/index.ts");
		expect(expoOnlyIndex).toContain(
			'import { expo } from "@better-auth/expo";',
		);
		expect(expoOnlyIndex).toContain("plugins: [expo()]");
		expect(expoOnlyIndex).toContain('trustedOrigins: ["acme://"]');
		expect(expoOnlyIndex).toContain("emailAndPassword: { enabled: true }");

		const expoAndNextIndex = writeContent(
			expoAndNext,
			"packages/auth/src/index.ts",
		);
		expect(expoAndNextIndex).toContain("plugins: [expo(), nextCookies()]");

		const standaloneIndex = writeContent(
			standalone,
			"packages/auth/src/index.ts",
		);
		expect(standaloneIndex).toContain(
			'trustedOrigins: [env.WEB_URL, "acme://"]',
		);
		expect(writeContent(standalone, "packages/auth/package.json")).toContain(
			'"@better-auth/expo"',
		);
	});
});
