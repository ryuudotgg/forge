import {
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	interpolate,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
	surfaceScripts,
} from "@ryuugg/core";
import { resolveAuthMethods } from "../auth/methods";
import { resolveAuthPlugins } from "../auth/plugins";
import type { EmailProvider, ForgeConfig } from "../config";
import { deps } from "../deps";
import { emailPreviewPort } from "../origins";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";
import vitest from "../tooling/vitest";
import { catalogRef } from "../versions";

const providers: Record<
	EmailProvider,
	{
		dependency: { name: string; version: string; catalog: string };
		keyVar: string;
		mock: ReadonlyArray<string>;
	}
> = {
	resend: {
		dependency: deps.resend,
		keyVar: "RESEND_API_KEY",
		mock: [
			'vi.mock("resend", () => ({',
			"  Resend: class {",
			"    emails = {",
			"      send: async (payload: { html: string; text: string }) => {",
			"        sent.push(payload);",
			"        return { error: null };",
			"      },",
			"    };",
			"  },",
			"}));",
		],
	},
	postmark: {
		dependency: deps.postmark,
		keyVar: "POSTMARK_SERVER_TOKEN",
		mock: [
			'vi.mock("postmark", () => ({',
			"  ServerClient: class {",
			"    sendEmail = async (payload: { HtmlBody: string; TextBody: string }) => {",
			"      sent.push({ html: payload.HtmlBody, text: payload.TextBody });",
			"    };",
			"  },",
			"}));",
		],
	},
	smtp: {
		dependency: deps.nodemailer,
		keyVar: "SMTP_URL",
		mock: [
			'vi.mock("nodemailer", () => ({',
			"  createTransport: () => ({",
			"    sendMail: async (payload: { html: string; text: string }) => {",
			"      sent.push(payload);",
			"    },",
			"  }),",
			"}));",
		],
	},
};

const messageTemplates = [
	{
		name: "invitation",
		file: "invitation",
		sample: [
			'      email: "invitee@example.com",',
			'      inviterName: "Ada",',
			'      inviterEmail: "ada@example.com",',
			'      organizationName: "Lumen Works",',
			'      invitationId: "inv_123",',
			'      url: "https://app.example.com/accept-invitation/inv_123",',
		],
		expected: "https://app.example.com/accept-invitation/inv_123",
		enabled: (config: ForgeConfig) =>
			resolveAuthPlugins(config).includes("organization"),
	},
	{
		name: "magicLink",
		file: "magic-link",
		sample: [
			'      url: "https://app.example.com/api/auth/magic-link/verify?token=abc",',
		],
		expected: "https://app.example.com/api/auth/magic-link/verify?token=abc",
		enabled: (config: ForgeConfig) =>
			resolveAuthMethods(config).includes("magic-link"),
	},
	{
		name: "verificationCode",
		file: "verification-code",
		sample: [
			'      code: "123456",',
			'      type: "forget-password",',
			"      expiresInMinutes: 5,",
		],
		expected: "123456",
		enabled: (config: ForgeConfig) =>
			resolveAuthMethods(config).includes("email-otp"),
	},
] as const;

export function emailTemplates(config: ForgeConfig) {
	if (config.authentication !== "better-auth") return [];
	return messageTemplates.filter((template) => template.enabled(config));
}

function messagesSource(config: ForgeConfig): string {
	const templates = emailTemplates(config);
	const imports = templates.map(
		(template) =>
			`import * as ${template.name} from "./templates/${template.file}";\n`,
	);

	const entries = ["...customTemplates", ...templates.map(({ name }) => name)];
	return interpolate(readTemplate("email/packages/email/src/messages.ts"), {
		IMPORTS: imports.join(""),
		MODULES: `{\n${entries.map((entry) => `  ${entry},`).join("\n")}\n}`,
	});
}

function testSource(config: ForgeConfig, provider: EmailProvider): string {
	const cases = emailTemplates(config).flatMap((template) => [
		"  {",
		"    message: {",
		'      to: "reader@example.com",',
		`      template: "${template.name}",`,
		"      props: {",
		...template.sample.map((line) => `  ${line}`),
		"      },",
		"    },",
		`    expected: "${template.expected}",`,
		"  },",
	]);

	return interpolate(readTemplate("email/packages/email/src/index.test.ts"), {
		MOCK: providers[provider].mock.join("\n"),
		KEY: providers[provider].keyVar,
		CASES: cases.join("\n"),
	});
}

const email = defineAddon<ForgeConfig, "email">({
	id: "email",
	name: "Email",
	version: "0.1.0",
	category: "workspace",
	exclusive: true,
	dependencies: [{ id: "typescript", type: "addon" }],
	targetMode: "single",
	when: (config) => config.emailProvider !== undefined,
	contribute: ({ config }) => {
		if (config.emailProvider === undefined) return [];

		const slug = config.slug ?? "my-app";
		const provider = providers[config.emailProvider];
		const lines = ['EMAIL_FROM=""', `${provider.keyVar}=""`];
		return [
			ensurePackageModule("email", "packages/email", {
				packageType: "library",
				template: { id: "email", version: 1 },
				capabilities: ["email"],
				slots: {},
			}),
			surfaceJson(ensuredModuleTarget("email"), "packageJson", {
				name: `@${slug}/email`,
				private: true,
				type: "module",
				exports: { ".": "./src/index.ts", "./env": "./env.ts" },
				scripts: { typecheck: "tsc --noEmit" },
			}),
			surfaceJson(ensuredModuleTarget("email"), "tsconfig", {
				extends: `@${slug}/tsconfig/base.json`,
				compilerOptions: {
					types: ["node"],
					paths: { [`@${slug}/email/*`]: ["./src/*"] },
				},
				include: ["./src", "./*.ts"],
				exclude: ["node_modules"],
			}),
			surfaceDependencies(ensuredModuleTarget("email"), "packageJson", [
				{ ...provider.dependency, type: "dependencies" },
				{ ...deps.reactEmail, type: "dependencies" },
				{ ...catalogRef("react", config), type: "dependencies" },
				{ ...catalogRef("reactDom", config), type: "dependencies" },
				{ ...deps.t3OssEnvCore, type: "dependencies" },
				{ ...deps.zod, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				{ ...deps.typesNode, type: "devDependencies" },
				{ ...deps.typesReact, type: "devDependencies" },
				{ ...deps.typescript, type: "devDependencies" },
			]),
			leafTextFile(
				ensuredModuleTarget("email"),
				"env.ts",
				interpolate(readTemplate("email/packages/email/env.ts"), {
					KEY: provider.keyVar,
				}),
			),
			leafTextFile(
				ensuredModuleTarget("email"),
				"src/index.ts",
				readTemplate(
					`email/packages/email/src/index.${config.emailProvider}.ts`,
				),
			),
			leafTextFile(
				ensuredModuleTarget("email"),
				"src/messages.ts",
				messagesSource(config),
			),
			leafTextFile(
				ensuredModuleTarget("email"),
				"src/custom.ts",
				readTemplate("email/packages/email/src/custom.ts"),
				{ update: "write-once" },
			),
			leafTextFile(
				ensuredModuleTarget("email"),
				"src/layout.tsx",
				readTemplate("email/packages/email/src/layout.tsx"),
				{ update: "starter" },
			),
			...emailTemplates(config).map((template) =>
				leafTextFile(
					ensuredModuleTarget("email"),
					`src/templates/${template.file}.tsx`,
					readTemplate(
						`email/packages/email/src/templates/${template.file}.tsx`,
					),
					{ update: "starter" },
				),
			),
			...(emailTemplates(config).length > 0
				? [
						surfaceDependencies(ensuredModuleTarget("email"), "packageJson", [
							{ ...deps.reactEmailUi, type: "devDependencies" },
						]),
						surfaceScripts(ensuredModuleTarget("email"), "packageJson", {
							dev: `email dev --dir src/templates --port ${emailPreviewPort}`,
						}),
					]
				: []),
			...(vitest.when(config) && emailTemplates(config).length > 0
				? [
						surfaceDependencies(ensuredModuleTarget("email"), "packageJson", [
							{ ...deps.vitest, type: "devDependencies" },
						]),
						surfaceScripts(ensuredModuleTarget("email"), "packageJson", {
							test: "vitest run",
						}),
						leafTextFile(
							ensuredModuleTarget("email"),
							"src/index.test.ts",
							testSource(config, config.emailProvider),
						),
					]
				: []),
			...(vitest.when(config) &&
			emailTemplates(config).some(
				(template) => template.name === "verificationCode",
			)
				? [
						leafTextFile(
							ensuredModuleTarget("email"),
							"src/verification-code.test.ts",
							readTemplate(
								"email/packages/email/src/verification-code.test.ts",
							),
							{ update: "starter" },
						),
					]
				: []),
			surfaceLines(projectTarget(), "rootEnv", lines, { section: "Email" }),
			surfaceLines(projectTarget(), "rootEnvExample", lines, {
				section: "Email",
			}),
		];
	},
});

export const emailMetadata = {
	id: "email",
	name: "Email",
	kind: "addon",
	hidden: true,
	experimental: false,
	description:
		"Creates a workspace package for sending email with your chosen provider.",
	keywords: ["email", "resend", "postmark", "smtp"],
	summary: "Send email from a workspace package.",
} as const satisfies FirstPartyAddonMetadata;

export default email;
