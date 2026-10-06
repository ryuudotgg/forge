import { confirm, isCancel, text } from "@clack/prompts";
import {
	loadDefinitionRegistry,
	reservedWebAppNames,
	standaloneBackendDevPort,
} from "@ryuugg/generators";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";
import webStep, { webSchema } from "./web";

const reservedNames = new Set<string>(reservedWebAppNames);

const webAppNameSchema = Schema.String.check(
	Schema.makeFilter((name) => {
		if (!/^[a-z][a-z0-9-]*$/.test(name))
			return `${name} isn't a valid web app name. Start with a lowercase letter and use only lowercase letters, numbers and hyphens.`;

		if (reservedNames.has(name))
			return `${name} is reserved. Pick another name for this web app.`;
	}),
);

export const webAppsSchema = Schema.Array(
	Schema.Struct({
		name: webAppNameSchema,
		framework: webSchema,
		client: Schema.optional(Schema.Boolean),
		port: Schema.optional(Schema.Number),
	}),
).check(
	Schema.makeFilter((apps) => {
		const names = new Set<string>();
		const portOwners = new Map<number, string>();
		for (const app of apps) {
			if (names.has(app.name))
				return `${app.name} is used by more than one web app.`;

			names.add(app.name);
			if (app.port === undefined) continue;

			if (!Number.isInteger(app.port) || app.port < 1 || app.port > 65535)
				return `${app.name} needs a port between 1 and 65535.`;

			if (app.port === standaloneBackendDevPort)
				return `${app.name} can't use port ${standaloneBackendDevPort}, which the API server uses.`;

			const owner = portOwners.get(app.port);
			if (owner !== undefined)
				return `${owner} and ${app.name} both use port ${app.port}.`;

			portOwners.set(app.port, app.name);
		}
	}),
);

export function webAppNameIssue(name: string, addonIds: ReadonlyArray<string>) {
	if (addonIds.includes(name))
		return `${name} is an addon id. Pick another name for this web app.`;
}

export function firstPartyAddonIds() {
	return loadDefinitionRegistry().registry.addons.map((addon) => addon.id);
}

export default defineStep<typeof webAppsSchema.Type>({
	id: "webApps",
	group: "platforms",
	configKey: "webApps",
	schema: webAppsSchema,
	dependencies: ["web"],
	shouldRun: (config) => !!config.platforms?.includes("web"),
	async execute(config, interactive) {
		if (!interactive) return SKIP;

		const apps: Array<(typeof webAppsSchema.Type)[number]> = [];
		const addonIds = firstPartyAddonIds();

		for (;;) {
			const more = await confirm({
				message: "Do you want to add another web app?",
				initialValue: false,
			});

			if (isCancel(more)) cancel();
			if (!more) return apps.length === 0 ? SKIP : apps;

			const name = await text({
				message: "What is the name of this web app?",
				validate(value) {
					const result = Schema.decodeUnknownResult(webAppsSchema)([
						...apps,
						{ name: value ?? "", framework: "nextjs" },
					]);

					if (Result.isFailure(result)) return result.failure.message;
					return webAppNameIssue(value ?? "", addonIds);
				},
			});

			if (isCancel(name)) cancel();

			const framework = await webStep.execute(config, true);
			const client = await confirm({
				message: `Mark ${name} as an API client?`,
				initialValue: false,
			});

			if (isCancel(client)) cancel();

			const result = Schema.decodeUnknownResult(webAppsSchema)([
				...apps,
				{ name, framework, ...(client ? { client: true } : {}) },
			]);

			if (Result.isFailure(result)) throw result.failure;

			apps.push(...result.success.slice(apps.length));
		}
	},
});
