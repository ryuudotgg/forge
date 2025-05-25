import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const backendOptions = [
	"Next.js",
	"Convex",
	"Hono",
	"Elysia",
	"µWebSockets",
	"Fastify",
	"Express",
	"None",
] as const;

export const backendSchema = z.enum(
	backendOptions.filter((backend) => backend !== "None"),
);

async function getBackend(): Promise<void> {
	const { web } = getUnsafeConfig();

	const backend = await select({
		message: "What is your preferred backend framework?",
		options: backendOptions.map((backend) => ({
			label: web === backend ? `${backend} (Recommended)` : backend,
			value: backend,
		})),
	});

	if (isCancel(backend)) cancel();
	if (backend !== "None") setConfig({ backend });
}

export default getBackend;
