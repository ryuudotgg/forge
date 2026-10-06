import {
	type Dependency,
	defineAddon,
	ensuredModuleTarget,
	ensurePackageModule,
	leafTextFile,
	projectTarget,
	surfaceDependencies,
	surfaceJson,
	surfaceLines,
} from "@ryuugg/core";
import { Effect } from "effect";
import {
	type ApiHostConsumer,
	apiHostError,
	apiHostFramework,
} from "../../api-host";
import { authMethods, type ForgeConfig } from "../../config";
import { envFileLine } from "../../data/providers";
import { deps } from "../../deps";
import {
	appOrigin,
	hasSecondaryClients,
	secondaryClientOrigins,
	standaloneApiOrigin,
} from "../../origins";
import { pmDlx, resolvePackageManager } from "../../pm";
import type { FirstPartyAddonMetadata } from "../../registry/types";
import { catalogRef } from "../../versions";
import { webAppInstances } from "../../web-apps";
import {
	authEmailMethods,
	authSocialProviders,
	authUsesPasskey,
} from "../methods";
import {
	authPluginEnvEntries,
	authPluginFiles,
	authPluginPackages,
	authPluginsBlockDeclarations,
	authSendsEmail,
} from "../plugins";
import { invitationPageContributions } from "./invitation-page";
import { renderBetterAuthTemplate, renderSecondaryAuthClient } from "./shared";

const listAnd = new Intl.ListFormat("en", { type: "conjunction" });

const betterAuthConsumer: ApiHostConsumer = {
	id: "better-auth",
	name: "Better Auth",
	slot: "auth",
};

function generateAuthSecret() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

const betterAuthAddon = defineAddon<ForgeConfig, "better-auth">({
	id: "better-auth",
	name: "Better Auth",
	version: "0.1.0",
	category: "auth",
	exclusive: true,
	dependencies: [
		{ id: "drizzle", type: "addon" },
		{ id: "prisma", type: "addon" },
	],
	targetMode: "single",
	target: (config, module) =>
		module.type === "app" &&
		module.framework === apiHostFramework(config) &&
		module.slots.auth !== undefined,
	when: (config) => config.authentication === "better-auth",
	contribute: ({ config, frameworks }) => {
		const slug = config.slug ?? "my-app";

		if (config.orm === undefined)
			throw new Error("You need to add an ORM before you can use Better Auth.");

		const emailMethods = authEmailMethods(config);
		if (emailMethods.length > 0 && config.emailProvider === undefined)
			throw new Error(
				`${listAnd.format(emailMethods.map((method) => authMethods.label(method)))} ${emailMethods.length === 1 ? "needs" : "need"} an email provider.`,
			);

		const failure = apiHostError(config, betterAuthConsumer, frameworks);
		if (failure !== undefined) return Effect.fail(failure);

		const pm = resolvePackageManager(config);
		const secretCommand = pmDlx(pm, "@better-auth/cli secret");
		const origin = appOrigin(config);
		const socialEnvLines = authSocialProviders(config).flatMap(
			({ envStem }) => [
				"",
				`${envStem}_CLIENT_ID=""`,
				`${envStem}_CLIENT_SECRET=""`,
			],
		);

		const pluginEnv = authPluginEnvEntries(config);
		const pluginEnvLines =
			pluginEnv.length > 0
				? ["", ...pluginEnv.map(({ name, example }) => `${name}=${example}`)]
				: [];

		const secondaryOrigins = secondaryClientOrigins(config);
		const selfHostedOrigins =
			secondaryOrigins.length > 0 && standaloneApiOrigin(config) === undefined
				? [envFileLine("WEB_URLS", secondaryOrigins.join(","))]
				: [];

		return [
			ensurePackageModule("auth", "packages/auth", {
				packageType: "library",
				template: { id: "auth", version: 1 },
				capabilities: ["auth"],
				slots: {},
			}),
			surfaceJson(ensuredModuleTarget("auth"), "packageJson", {
				name: `@${slug}/auth`,
				private: true,
				type: "module",
				exports: {
					".": "./src/index.ts",
					"./env": "./env.ts",
					"./client": "./src/client.ts",
					"./client-address": "./src/client-address.ts",
				},
				scripts: { typecheck: "tsc --noEmit" },
			}),
			surfaceJson(ensuredModuleTarget("auth"), "tsconfig", {
				extends: `@${slug}/tsconfig/base.json`,
				compilerOptions: {
					...(authPluginsBlockDeclarations(config)
						? { declaration: false, declarationMap: false }
						: {}),
					types: ["node"],
					paths: { [`@${slug}/auth/*`]: ["./src/*"] },
				},
				include: ["./src", "./*.ts"],
				exclude: ["node_modules"],
			}),
			surfaceDependencies(ensuredModuleTarget("auth"), "packageJson", [
				{
					name: `@${slug}/db`,
					version: "workspace:*",
					type: "dependencies",
				},
				{ ...deps.t3OssEnvCore, type: "dependencies" },
				{ ...catalogRef("betterAuth", config), type: "dependencies" },
				...(authSendsEmail(config)
					? [
							{
								name: `@${slug}/email`,
								version: "workspace:*",
								type: "dependencies",
							} satisfies Dependency,
						]
					: []),
				...authPluginPackages(config, "auth").map(
					(dependency): Dependency => ({
						...dependency,
						type: "dependencies",
					}),
				),
				...(config.mobile === "expo"
					? [{ ...deps.betterAuthExpo, type: "dependencies" as const }]
					: []),
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
				ensuredModuleTarget("auth"),
				"env.ts",
				renderBetterAuthTemplate(config, "packages/auth/env.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("auth"),
				"src/client.ts",
				renderBetterAuthTemplate(config, "packages/auth/src/client.ts"),
			),
			leafTextFile(
				ensuredModuleTarget("auth"),
				"src/client-address.ts",
				renderBetterAuthTemplate(config, "packages/auth/src/client-address.ts"),
			),
			...webAppInstances(config)
				.filter((instance) => instance.client === true)
				.flatMap((instance) => {
					const sourceRoot =
						instance.framework === "nextjs"
							? ""
							: instance.framework === "react-router"
								? "app/"
								: "src/";

					const target = ensuredModuleTarget(instance.key);
					return [
						leafTextFile(
							target,
							`${sourceRoot}lib/auth-client.ts`,
							renderSecondaryAuthClient(config, instance.framework),
						),
						surfaceDependencies(target, "packageJson", [
							{ ...catalogRef("betterAuth", config), type: "dependencies" },
							...authPluginPackages(config, "auth").map(
								(dependency): Dependency => ({
									...dependency,
									type: "dependencies",
								}),
							),
						]),
					];
				}),
			...invitationPageContributions(config),
			...authPluginFiles(config).map((path) =>
				leafTextFile(
					ensuredModuleTarget("auth"),
					path,
					renderBetterAuthTemplate(config, `packages/auth/${path}`),
				),
			),
			...(hasSecondaryClients(config) && authUsesPasskey(config)
				? [
						leafTextFile(
							ensuredModuleTarget("auth"),
							"README.md",
							[
								"# Passkeys",
								"",
								"For apps on different subdomains, set `PASSKEY_RP_ID` in the root `.env` to their shared registrable parent domain. For `https://app.example.com` and `https://admin.example.com`, use `example.com` and include the secondary origin in `WEB_URLS`.",
								"",
								"Each app hostname must equal the RP ID or be its subdomain. Unrelated domains cannot share this RP ID. Leave `PASSKEY_RP_ID` empty to use the primary app hostname, including `localhost` during development.",
								"",
								"Choose the RP ID before registering passkeys. Existing passkeys remain bound to the RP ID used at registration.",
								"",
							].join("\n"),
						),
					]
				: []),

			surfaceLines(
				projectTarget(),
				"rootEnv",
				[
					`# @use ${secretCommand}`,
					`AUTH_SECRET="${generateAuthSecret()}"`,
					'AUTH_COOKIE_DOMAIN="" # empty for localhost, eg. ".example.com"',
					'AUTH_TRUSTED_PROXIES="" # comma separated proxy IPs or CIDRs, proxies must append the client to X-Forwarded-For, empty for direct connections',
					'AUTH_CLIENT_IP_HEADER="" # only set a header your platform overwrites with the client IP, eg. x-real-ip on Vercel, empty for none',
					"",
					envFileLine("APP_ORIGIN", origin),
					...selfHostedOrigins,
					...(hasSecondaryClients(config) && authUsesPasskey(config)
						? [envFileLine("PASSKEY_RP_ID", "")]
						: []),
					...socialEnvLines,
					...pluginEnvLines,
				],
				{ section: "Better Auth" },
			),
			surfaceLines(
				projectTarget(),
				"rootEnvExample",
				[
					`# @use ${secretCommand}`,
					'AUTH_SECRET=""',
					'AUTH_COOKIE_DOMAIN="" # empty for localhost, eg. ".example.com"',
					'AUTH_TRUSTED_PROXIES="" # comma separated proxy IPs or CIDRs, proxies must append the client to X-Forwarded-For, empty for direct connections',
					'AUTH_CLIENT_IP_HEADER="" # only set a header your platform overwrites with the client IP, eg. x-real-ip on Vercel, empty for none',
					"",
					envFileLine("APP_ORIGIN", origin),
					...selfHostedOrigins,
					...(hasSecondaryClients(config) && authUsesPasskey(config)
						? [envFileLine("PASSKEY_RP_ID", "")]
						: []),
					...socialEnvLines,
					...pluginEnvLines,
				],
				{ section: "Better Auth" },
			),
		];
	},
});

export const betterAuthMetadata = {
	description:
		"Adds Better Auth server and client surfaces to a compatible application target.",
	experimental: false,
	hidden: false,
	id: "better-auth",
	keywords: ["auth", "authentication", "better-auth"],
	kind: "addon",
	name: "Better Auth",
	summary: "Add Better Auth to an app target.",
} as const satisfies FirstPartyAddonMetadata;

export default betterAuthAddon;
