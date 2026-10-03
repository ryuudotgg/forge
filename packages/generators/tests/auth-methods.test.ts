import { describe, expect, it } from "vitest";
import {
	type AuthMethod,
	configWithoutInstall,
	type ForgeConfig,
	resolveAuthMethods,
} from "../src";
import { authSocialProviders, authUsesPassword } from "../src/auth/methods";
import { plannedProject } from "./planner-harness";

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	backend: "hono",
	catalogs: "scoped",
	name: "Acme",
	packageManager: "pnpm",
	platforms: ["web"],
	runtime: "Node.js",
	slug: "acme",
	web: "nextjs",
};

const selections: ReadonlyArray<{
	name: string;
	config: ForgeConfig;
	expected: ReadonlyArray<AuthMethod>;
}> = [
	{
		name: "unset standalone",
		config: {},
		expected: ["email-password", "google", "apple"],
	},
	{
		name: "unset Next.js self",
		config: { backend: "self" },
		expected: ["google", "apple"],
	},
	{
		name: "unset Expo self",
		config: { backend: "self", mobile: "expo", platforms: ["web", "mobile"] },
		expected: ["email-password", "google", "apple"],
	},
	{
		name: "email and password",
		config: { authMethods: ["email-password"] },
		expected: ["email-password"],
	},
	{
		name: "Google",
		config: { authMethods: ["google"] },
		expected: ["google"],
	},
	{
		name: "Apple",
		config: { authMethods: ["apple"] },
		expected: ["apple"],
	},
	{
		name: "both social providers",
		config: { authMethods: ["google", "apple"] },
		expected: ["google", "apple"],
	},
	{
		name: "all methods",
		config: { authMethods: ["email-password", "google", "apple"] },
		expected: ["email-password", "google", "apple"],
	},
	{
		name: "email and password on self",
		config: { backend: "self", authMethods: ["email-password"] },
		expected: ["email-password"],
	},
];

const schemaVariants: ReadonlyArray<{ name: string; config: ForgeConfig }> = [
	{
		name: "Drizzle Postgres",
		config: { orm: "drizzle", database: "postgresql" },
	},
	{ name: "Drizzle MySQL", config: { orm: "drizzle", database: "mysql" } },
	{
		name: "Drizzle PlanetScale MySQL",
		config: {
			orm: "drizzle",
			database: "mysql",
			databaseProvider: "planetscale",
		},
	},
	{ name: "Drizzle SQLite", config: { orm: "drizzle", database: "sqlite" } },
	{
		name: "Prisma Postgres",
		config: { orm: "prisma", database: "postgresql" },
	},
	{ name: "Prisma MySQL", config: { orm: "prisma", database: "mysql" } },
	{ name: "Prisma SQLite", config: { orm: "prisma", database: "sqlite" } },
];

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
) {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("auth methods", () => {
	it("resolves the legacy rule for standalone, self and Expo", () => {
		expect(resolveAuthMethods(baseConfig)).toEqual([
			"email-password",
			"google",
			"apple",
		]);

		expect(resolveAuthMethods({ ...baseConfig, backend: "self" })).toEqual([
			"google",
			"apple",
		]);

		expect(
			resolveAuthMethods({ ...baseConfig, backend: "self", mobile: "expo" }),
		).toEqual(["email-password", "google", "apple"]);
	});

	it("returns an explicit list unchanged and orders social providers by table", () => {
		const methods: ReadonlyArray<AuthMethod> = ["apple", "google"];
		const config: ForgeConfig = { ...baseConfig, authMethods: methods };

		expect(resolveAuthMethods(config)).toBe(methods);
		expect(authUsesPassword(config)).toBe(false);
		expect(authSocialProviders(config)).toEqual([
			{ id: "google", envStem: "AUTH_GOOGLE" },
			{ id: "apple", envStem: "AUTH_APPLE" },
		]);
	});

	it.each(
		[
			null,
			false,
			1,
			"google",
			[],
			["unknown"],
			["google", null],
			new Array<unknown>(1),
		].map((value) => ({ value })),
	)("rejects an undecoded invalid value $value", ({ value }) => {
		const config: ForgeConfig = Object.assign({}, baseConfig, {
			authMethods: value,
		});

		expect(() => resolveAuthMethods(config)).toThrow("Invalid Auth Methods:");
	});

	it("drops methods when Better Auth is removed", () => {
		const config: ForgeConfig = {
			authentication: "better-auth",
			authMethods: ["google"],
			orm: "drizzle",
		};

		expect(configWithoutInstall(config, "better-auth")).toEqual({
			orm: "drizzle",
		});
	});

	describe.each(schemaVariants)("$name", (variant) => {
		it.each(selections)("renders $name", async (selection) => {
			const config: ForgeConfig = {
				...baseConfig,
				...variant.config,
				...selection.config,
			};

			const plan = await plannedProject(config);
			const server = writeContent(plan, "packages/auth/src/index.ts");
			const authEnv = writeContent(plan, "packages/auth/env.ts");
			const hasPassword = selection.expected.includes("email-password");
			const hasSocial = selection.expected.some(
				(method) => method !== "email-password",
			);

			const schemaPath =
				config.orm === "drizzle"
					? "packages/db/src/schema/auth.ts"
					: "packages/db/prisma/schema.prisma";

			expect(resolveAuthMethods(config)).toEqual(selection.expected);
			expect(authUsesPassword(config)).toBe(hasPassword);
			expect(server.includes("emailAndPassword: { enabled: true }")).toBe(
				hasPassword,
			);

			expect(
				server.includes("const socialProviders = getSocialProviders();"),
			).toBe(hasSocial);

			expect(
				server.includes("...(socialProviders ? { socialProviders } : {}),"),
			).toBe(hasSocial);

			expect(server.includes("function getSocialProviders()")).toBe(hasSocial);
			expect(server).toContain("baseURL: normalizeOrigin(env.APP_ORIGIN)");
			expect(server).toContain("function normalizeCookieDomain");

			expect(server).not.toMatch(/__[A-Z_]+__/);
			expect(authEnv).not.toMatch(/__[A-Z_]+__/);
			expect(server).not.toContain("\n\n\n");
			expect(authEnv).not.toContain("\n\n\n");

			expect(/\bpassword\b/.test(writeContent(plan, schemaPath))).toBe(
				authUsesPassword(config),
			);

			for (const provider of ["google", "apple"]) {
				const selected = selection.expected.some(
					(method) => method === provider,
				);

				const stem = `AUTH_${provider.toUpperCase()}`;
				for (const suffix of ["CLIENT_ID", "CLIENT_SECRET"]) {
					const envName = `${stem}_${suffix}`;
					for (const path of [".env", ".env.example"])
						expect(writeContent(plan, path).includes(`${envName}=""`)).toBe(
							selected,
						);

					expect(
						authEnv.includes(`${envName}: z.string().trim().min(1).optional()`),
					).toBe(selected);

					expect(authEnv.includes(`${envName}: process.env.${envName}`)).toBe(
						selected,
					);
				}

				expect(server.includes(`  const ${provider} =`)).toBe(selected);
				expect(server.includes(`/api/auth/callback/${provider}`)).toBe(
					selected,
				);

				expect(server.includes(`...(${provider} ? { ${provider} } : {})`)).toBe(
					selected,
				);
			}

			if (hasSocial) {
				const guard = ["google", "apple"]
					.filter((provider) =>
						selection.expected.some((method) => method === provider),
					)
					.map((provider) => `!${provider}`)
					.join(" && ");

				expect(server).toContain(`  if (${guard}) return null;`);
			}
		});

		it("renders all explicit methods identically to legacy standalone defaults", async () => {
			const config = { ...baseConfig, ...variant.config };
			const legacy = await plannedProject(config);
			const explicit = await plannedProject({
				...config,
				authMethods: ["email-password", "google", "apple"],
			});

			for (const path of [
				"packages/auth/src/index.ts",
				"packages/auth/env.ts",
				".env.example",
			])
				expect(writeContent(explicit, path)).toBe(writeContent(legacy, path));
		});
	});

	it("renders both social providers exactly as the legacy template did", async () => {
		const plan = await plannedProject({
			...baseConfig,
			orm: "drizzle",
			database: "postgresql",
		});

		const server = writeContent(plan, "packages/auth/src/index.ts");

		expect(server).toContain(`function getSocialProviders() {
  const google =
    env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.AUTH_GOOGLE_CLIENT_ID,
          clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
          redirectURI: \`\${normalizeOrigin(env.APP_ORIGIN)}/api/auth/callback/google\`,
        }
      : null;

  const apple =
    env.AUTH_APPLE_CLIENT_ID && env.AUTH_APPLE_CLIENT_SECRET
      ? {
          clientId: env.AUTH_APPLE_CLIENT_ID,
          clientSecret: env.AUTH_APPLE_CLIENT_SECRET,
          redirectURI: \`\${normalizeOrigin(env.APP_ORIGIN)}/api/auth/callback/apple\`,
        }
      : null;

  if (!google && !apple) return null;

  return {
    ...(apple ? { apple } : {}),
    ...(google ? { google } : {}),
  };
}

function normalizeOrigin(`);

		expect(server).toContain(
			"const authSecret = getAuthSecret();\nconst socialProviders = getSocialProviders();\nconst cookieDomain",
		);

		expect(server).toContain(
			"  },\n\n  ...(socialProviders ? { socialProviders } : {}),\n\n  account:",
		);
	});
});
