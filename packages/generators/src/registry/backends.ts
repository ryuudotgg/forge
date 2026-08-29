import type { FrameworkDefinition } from "@ryuujs/core";
import type { ForgeConfig } from "../config";
import { fastifyFramework } from "../frameworks/fastify";
import { honoFramework } from "../frameworks/hono";

export const standaloneBackendFrameworks: ReadonlyArray<FrameworkDefinition> = [
	fastifyFramework,
	honoFramework,
];

export const standaloneBackendIds: ReadonlySet<string> = new Set(
	standaloneBackendFrameworks.map((framework) => framework.id),
);

export function standaloneBackendInPlay(
	config: ForgeConfig,
): string | undefined {
	return config.backend !== undefined &&
		standaloneBackendIds.has(config.backend)
		? config.backend
		: undefined;
}
