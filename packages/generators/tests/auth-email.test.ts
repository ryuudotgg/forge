import { describe, expect, it } from "vitest";
import { renderBetterAuthTemplate } from "../src/auth/better-auth/shared";
import { authEmailMethods, authUsesEmail } from "../src/auth/methods";
import {
	authPluginBindings,
	authPluginFiles,
	authPluginTables,
	resolveAuthPlugins,
} from "../src/auth/plugins";
import type { AuthMethod, EmailProvider, ForgeConfig } from "../src/config";
import { plannedProject } from "./planner-harness";

const baseConfig: ForgeConfig = {
	authentication: "better-auth",
	backend: "hono",
	name: "Acme",
	packageManager: "pnpm",
	platforms: ["web"],
	runtime: "Node.js",
	slug: "acme",
	web: "nextjs",
};

const emailMethods: ReadonlyArray<{
	method: AuthMethod;
	server: string;
	client: string;
	callback: string;
	storage: string;
	template: string;
	label: string;
}> = [
	{
		method: "email-otp",
		server: "emailOTP",
		client: "emailOTPClient",
		callback: "async sendVerificationOTP({ email, otp, type })",
		storage: 'emailOTP({\n      storeOTP: "hashed",',
		template: 'template: "verificationCode",',
		label: "Email OTP",
	},
	{
		method: "magic-link",
		server: "magicLink",
		client: "magicLinkClient",
		callback: "async sendMagicLink({ email, url })",
		storage: 'magicLink({\n      storeToken: "hashed",',
		template: 'template: "magicLink",',
		label: "Magic link",
	},
];

const otpSendHook = [
	"  hooks: {",
	"    before: createAuthMiddleware(async (ctx) => {",
	"      const sendsOTP = [",
	'        "/email-otp/send-verification-otp",',
	'        "/email-otp/request-password-reset",',
	'        "/forget-password/email-otp",',
	'        "/email-otp/request-email-change",',
	"      ].includes(ctx.path);",
	"",
	"      if (sendsOTP && !canSendEmail())",
	`        throw new Error("Email isn't configured.");`,
	"    }),",
	"  },",
].join("\n");

const providers: ReadonlyArray<EmailProvider> = ["resend", "postmark", "smtp"];
const variants: ReadonlyArray<{ name: string; config: ForgeConfig }> = [
	{
		name: "Drizzle Postgres",
		config: { orm: "drizzle", database: "postgresql" },
	},
	{ name: "Drizzle MySQL", config: { orm: "drizzle", database: "mysql" } },
	{
		name: "Drizzle PlanetScale",
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
	{
		name: "Prisma PlanetScale",
		config: {
			orm: "prisma",
			database: "mysql",
			databaseProvider: "planetscale",
		},
	},
	{ name: "Prisma SQLite", config: { orm: "prisma", database: "sqlite" } },
];

function writeContent(
	plan: Awaited<ReturnType<typeof plannedProject>>,
	path: string,
): string {
	const write = plan.writes.find((entry) => entry.path === path);
	if (write === undefined) throw new Error(`Missing Write: ${path}`);
	return write.content;
}

describe("email authentication methods", () => {
	it.each(emailMethods)(
		"registers $method for web and Expo",
		({ method, client }) => {
			const config: ForgeConfig = {
				...baseConfig,
				authMethods: [method],
				emailProvider: "resend",
			};

			expect(authUsesEmail(config)).toBe(true);
			expect(resolveAuthPlugins(config)).toEqual([]);
			expect(authPluginTables(config)).toEqual([]);
			expect(authPluginFiles(config)).toEqual([]);
			expect(authPluginBindings(config, "client")).toEqual([
				{ module: "better-auth/client/plugins", name: client },
			]);

			expect(authPluginBindings(config, "expo")).toEqual(
				authPluginBindings(config, "client"),
			);
		},
	);

	it.each(emailMethods)(
		"rejects $method without email at the generator boundary",
		async ({ method, label }) => {
			await expect(
				plannedProject({
					...baseConfig,
					orm: "drizzle",
					database: "sqlite",
					authMethods: [method],
				}),
			).rejects.toThrow(`${label} needs an email provider.`);
		},
	);

	it("names both email methods when neither has a provider", async () => {
		await expect(
			plannedProject({
				...baseConfig,
				orm: "drizzle",
				database: "sqlite",
				authMethods: ["email-password", "magic-link", "email-otp"],
			}),
		).rejects.toThrow("Magic link and Email OTP need an email provider.");
	});

	it.each(variants)(
		"generates both methods on $name with every email provider",
		async ({ config }) => {
			for (const emailProvider of providers) {
				const plan = await plannedProject({
					...baseConfig,
					...config,
					emailProvider,
					authMethods: ["email-otp", "magic-link"],
				});

				const server = writeContent(plan, "packages/auth/src/index.ts");
				const client = writeContent(plan, "packages/auth/src/client.ts");

				expect(server).toContain(
					'import { emailOTP, magicLink } from "better-auth/plugins";',
				);

				for (const method of emailMethods) {
					expect(server).toContain(`${method.server}({`);
					expect(server).toContain(method.callback);
					expect(server).toContain(method.storage);
					expect(server).toContain(method.template);
					expect(client).toContain(`${method.client}()`);
				}

				expect(server).toContain(
					'import { canSendEmail, sendEmail } from "@acme/email";',
				);

				expect(server).toContain(
					'import { createAuthMiddleware } from "better-auth/api";',
				);

				expect(server).toContain(otpSendHook);
				expect(server).toContain("await sendEmail({");

				expect(server).toContain("const OTP_EXPIRES_IN = 60 * 5; // 5 minutes");
				expect(server).toContain("expiresIn: OTP_EXPIRES_IN,");
				expect(server).toContain("expiresInMinutes: OTP_EXPIRES_IN / 60");

				expect(server).toContain("to: email,");
				expect(server).not.toContain("emailAndPassword:");
				expect(client).toContain('from "better-auth/client/plugins"');
				expect(client).not.toContain("ReturnType<typeof createAuthClient>");
				expect(writeContent(plan, "packages/auth/package.json")).toContain(
					'"@acme/email": "workspace:*"',
				);

				expect(writeContent(plan, "packages/email/package.json")).toContain(
					`"${emailProvider === "smtp" ? "nodemailer" : emailProvider}"`,
				);

				expect(writeContent(plan, "packages/auth/tsconfig.json")).not.toContain(
					'"declaration": false',
				);
			}
		},
	);

	it.each(emailMethods)(
		"generates $method alone without enabling the other method",
		async ({ method, server, client }) => {
			const plan = await plannedProject({
				...baseConfig,
				orm: "drizzle",
				database: "sqlite",
				emailProvider: "resend",
				authMethods: [method],
			});

			const other = emailMethods.find((entry) => entry.method !== method);
			if (other === undefined) throw new Error("Missing Email Method");

			expect(writeContent(plan, "packages/auth/src/index.ts")).toContain(
				`${server}({`,
			);

			expect(writeContent(plan, "packages/auth/src/index.ts")).not.toContain(
				`${other.server}({`,
			);

			expect(
				writeContent(plan, "packages/auth/src/index.ts").includes(otpSendHook),
			).toBe(method === "email-otp");

			expect(
				writeContent(plan, "packages/auth/src/index.ts").includes(
					"canSendEmail",
				),
			).toBe(method === "email-otp");

			expect(
				writeContent(plan, "packages/auth/src/index.ts").includes(
					"const OTP_EXPIRES_IN = 60 * 5; // 5 minutes",
				),
			).toBe(method === "email-otp");

			expect(writeContent(plan, "packages/auth/src/client.ts")).toContain(
				`${client}()`,
			);

			expect(writeContent(plan, "packages/auth/src/client.ts")).not.toContain(
				`${other.client}()`,
			);
		},
	);

	it("generates email plugins in the Expo client", async () => {
		const plan = await plannedProject({
			...baseConfig,
			orm: "drizzle",
			database: "sqlite",
			platforms: ["web", "mobile"],
			mobile: "expo",
			emailProvider: "smtp",
			authMethods: ["email-otp", "magic-link"],
		});

		const client = writeContent(plan, "apps/mobile/src/lib/auth-client.ts");

		expect(client).toContain("emailOTPClient()");
		expect(client).toContain("magicLinkClient()");
		expect(client).toContain("expoClient({");
	});

	it.each<{ name: string; config: ForgeConfig; cookie?: string }>([
		{
			name: "Next.js",
			config: { backend: "self", web: "nextjs" },
			cookie: "nextCookies()",
		},
		{
			name: "TanStack Start",
			config: { backend: "self", web: "tanstack-start" },
			cookie: "tanstackStartCookies()",
		},
		{ name: "React Router", config: { backend: "self", web: "react-router" } },
		{ name: "Express", config: { backend: "express" } },
		{ name: "Fastify", config: { backend: "fastify" } },
	])(
		"composes email methods with passkey and username on $name",
		async ({ config, cookie }) => {
			const plan = await plannedProject({
				...baseConfig,
				...config,
				orm: "drizzle",
				database: "sqlite",
				emailProvider: "postmark",
				authMethods: ["magic-link", "email-password", "passkey", "email-otp"],
				authPlugins: ["username"],
			});

			const server = writeContent(plan, "packages/auth/src/index.ts");
			const client = writeContent(plan, "packages/auth/src/client.ts");

			expect(server).toContain("passkeyPlugin()");
			expect(server).toContain("username()");
			expect(server).toContain("emailOTP({");
			expect(server).toContain("magicLink({");

			expect(server).toContain("emailAndPassword: { enabled: true }");
			if (cookie !== undefined) expect(server).toContain(cookie);

			expect(client).toContain("passkeyClient()");
			expect(client).toContain("usernameClient()");
			expect(client).toContain("emailOTPClient()");
			expect(client).toContain("magicLinkClient()");
		},
	);

	it("keeps default auth bytes when an unused email provider is configured", async () => {
		const config: ForgeConfig = {
			...baseConfig,
			orm: "drizzle",
			database: "sqlite",
		};

		const baseline = await plannedProject(config);
		const withEmail = await plannedProject({
			...config,
			emailProvider: "resend",
		});

		for (const path of [
			"packages/auth/src/index.ts",
			"packages/auth/src/client.ts",
			"packages/auth/package.json",
			"packages/auth/env.ts",
			"packages/auth/tsconfig.json",
		])
			expect(writeContent(withEmail, path)).toBe(writeContent(baseline, path));

		expect(authUsesEmail(config)).toBe(false);
		expect(authEmailMethods(config)).toEqual([]);
		expect(
			authEmailMethods({
				...config,
				authMethods: ["magic-link", "google", "email-otp"],
			}),
		).toEqual(["magic-link", "email-otp"]);

		expect(
			authEmailMethods({ authentication: "clerk", authMethods: ["email-otp"] }),
		).toEqual([]);

		expect(
			authUsesEmail({ authentication: "clerk", authMethods: ["email-otp"] }),
		).toBe(false);

		expect(
			renderBetterAuthTemplate(config, "packages/auth/src/client.ts"),
		).toContain("ReturnType<typeof createAuthClient>");
	});
});
