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
} from "@ryuugg/core";
import type { EmailProvider, ForgeConfig } from "../config";
import { deps } from "../deps";
import type { FirstPartyAddonMetadata } from "../registry/types";
import { readTemplate } from "../template";

const providers: Record<
	EmailProvider,
	{
		dependency: { name: string; version: string; catalog: string };
		keyVar: string;
	}
> = {
	resend: { dependency: deps.resend, keyVar: "RESEND_API_KEY" },
	postmark: { dependency: deps.postmark, keyVar: "POSTMARK_SERVER_TOKEN" },
	smtp: { dependency: deps.nodemailer, keyVar: "SMTP_URL" },
};

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
				{ ...deps.t3OssEnvCore, type: "dependencies" },
				{ ...deps.zod, type: "dependencies" },
				{
					name: `@${slug}/tsconfig`,
					version: "workspace:*",
					type: "devDependencies",
				},
				{ ...deps.typesNode, type: "devDependencies" },
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
