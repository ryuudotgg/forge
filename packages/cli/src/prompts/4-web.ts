import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const webOptions = [
	"Next.js",
	"React Router",
	"TanStack Router",
	"TanStack Start",
] as const;

export const webSchema = z.enum(webOptions);

async function getWeb(): Promise<void> {
	const { platforms } = getUnsafeConfig();
	if (!platforms?.includes("Web")) return;

	const frontend = await select({
		message: "What is your preferred web framework?",
		options: webOptions.map((frontend, index) => ({
			label: index === 0 ? `${frontend} (Recommended)` : frontend,
			value: frontend,
		})),
	});

	if (isCancel(frontend)) cancel();

	setConfig({ web: frontend });
}

export default getWeb;
