import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

const desktopOptions = ["Tauri", "Electron"] as const;
export const desktopSchema = z.enum(desktopOptions);

async function getDesktop(): Promise<void> {
	const { platforms } = getUnsafeConfig();
	if (!platforms?.includes("Desktop")) return;

	const desktop = await select({
		message: "What is your preferred desktop framework?",
		options: desktopOptions.map((desktop, index) => ({
			label: index === 0 ? `${desktop} (Recommended)` : desktop,
			value: desktop,
		})),
	});

	if (isCancel(desktop)) cancel();

	setConfig({ desktop });
}

export default getDesktop;
