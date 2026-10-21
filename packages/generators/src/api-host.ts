import { type FrameworkDefinition, GeneratorError } from "@ryuugg/core";
import {
	backends,
	type ForgeConfig,
	mobileFrameworks,
	type RpcProvider,
	rpcProviders,
	webFrameworks,
} from "./config";
import { expressFramework } from "./frameworks/express";
import { fastifyFramework } from "./frameworks/fastify";
import { honoFramework } from "./frameworks/hono";
import { nextjsFramework } from "./frameworks/nextjs";
import { reactRouterFramework } from "./frameworks/react-router";
import { tanstackRouterFramework } from "./frameworks/tanstack-router";
import { tanstackStartFramework } from "./frameworks/tanstack-start";
import { type RpcHostFramework, rpcDescriptors } from "./rpc";

export const apiHostFrameworks: ReadonlyArray<FrameworkDefinition> = [
	expressFramework,
	fastifyFramework,
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
	readonly slot: string;
}

export function resolveApiHost(
	config: ForgeConfig,
	slot: string,
	frameworks: ReadonlyArray<FrameworkDefinition> = apiHostFrameworks,
): ApiHost | undefined {
	const backend = frameworks.find((entry) => entry.id === config.backend);
	if (backend?.slots.includes(slot)) return "server";
	if (config.backend !== undefined && config.backend !== "self")
		return undefined;

	const web = frameworks.find((entry) => entry.id === config.web);
	return web?.slots.includes(slot) ? "web" : undefined;
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
	if (resolveApiHost(config, consumer.slot, frameworks) !== undefined)
		return undefined;

	if (
		config.backend === undefined &&
		config.web === undefined &&
		config.mobile === undefined
	)
		return undefined;

	const web = frameworks.find((entry) => entry.id === config.web);
	return new GeneratorError({
		generatorId: consumer.id,
		reason: "api-host-required",
		generatorName: consumer.name,
		frameworkName: web?.name ?? "The selected web framework",
	});
}

export function rpcConsumer(id: RpcProvider): ApiHostConsumer {
	return { id, name: rpcProviders.label(id), slot: id };
}

function isRpcHost(
	framework: string | undefined,
): framework is RpcHostFramework {
	return (
		framework === "nextjs" ||
		framework === "react-router" ||
		framework === "tanstack-start" ||
		framework === "hono" ||
		framework === "express" ||
		framework === "fastify"
	);
}

export function rpcProviderError(
	config: ForgeConfig,
	id: RpcProvider,
	frameworks: ReadonlyArray<FrameworkDefinition> = apiHostFrameworks,
): GeneratorError | undefined {
	const host = apiHostFramework(config);
	const support = rpcDescriptors[id].support;
	const unsupported = (frameworkName: string) =>
		new GeneratorError({
			generatorId: id,
			generatorName: rpcProviders.label(id),
			reason: "framework-not-supported-yet",
			frameworkName,
		});

	if (isRpcHost(host) && !support.hosts[host]) {
		const frameworkName =
			host === "hono" || host === "express" || host === "fastify"
				? backends.label(host)
				: webFrameworks.label(host);

		return unsupported(frameworkName);
	}

	const failure = apiHostError(config, rpcConsumer(id), frameworks);
	if (failure !== undefined) return failure;

	if (
		config.web !== undefined &&
		config.web !== host &&
		!support.clients[config.web]
	)
		return unsupported(webFrameworks.label(config.web));

	if (config.mobile === "expo" && !support.clients.expo)
		return unsupported(mobileFrameworks.label(config.mobile));

	return undefined;
}
