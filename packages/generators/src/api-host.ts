import { type FrameworkDefinition, GeneratorError } from "@ryuujs/core";
import type { ForgeConfig } from "./config";
import { honoFramework } from "./frameworks/hono";
import { nextjsFramework } from "./frameworks/nextjs";
import { reactRouterFramework } from "./frameworks/react-router";
import { tanstackRouterFramework } from "./frameworks/tanstack-router";
import { tanstackStartFramework } from "./frameworks/tanstack-start";

export const apiHostFrameworks: ReadonlyArray<FrameworkDefinition> = [
	honoFramework,
	nextjsFramework,
	reactRouterFramework,
	tanstackRouterFramework,
	tanstackStartFramework,
];

export type ApiHost = "server" | "web";

export interface ApiHostConsumer {
	readonly id: string;
	readonly name: string;
}

export function resolveApiHost(
	config: ForgeConfig,
	frameworks: ReadonlyArray<FrameworkDefinition> = apiHostFrameworks,
): ApiHost | undefined {
	const backend = frameworks.find((entry) => entry.id === config.backend);
	if (backend?.slots.includes("trpc")) return "server";
	if (config.backend !== undefined && config.backend !== "self")
		return undefined;

	const web = frameworks.find((entry) => entry.id === config.web);
	return web?.slots.includes("trpc") ? "web" : undefined;
}

export function apiHostFramework(config: ForgeConfig): string | undefined {
	return config.backend === undefined || config.backend === "self"
		? config.web
		: config.backend;
}

export function apiHostError(
	config: ForgeConfig,
	consumer: ApiHostConsumer,
	frameworks: ReadonlyArray<FrameworkDefinition> = apiHostFrameworks,
): GeneratorError | undefined {
	if (resolveApiHost(config, frameworks) !== undefined) return undefined;
	if (config.backend === undefined && config.web === undefined)
		return undefined;

	const web = frameworks.find((entry) => entry.id === config.web);

	return new GeneratorError({
		generatorId: consumer.id,
		reason: "api-host-required",
		generatorName: consumer.name,
		frameworkName: web?.name ?? "The selected web framework",
	});
}
