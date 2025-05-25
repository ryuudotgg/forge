import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod/v4";
import { setConfig } from "../config";
import { cancel } from "../utils/cancel";

export const proceedToAddonsSchema = z.boolean();

async function getProceedToAddons(): Promise<void> {
	const proceedToAddons = await confirm({
		message: "Do you want to continue selecting addons?",
		active: "Yes (Recommended - Lengthy)",
		inactive: "No",
	});

	if (isCancel(proceedToAddons)) cancel();

	setConfig({ proceedToAddons });
}

export default getProceedToAddons;
