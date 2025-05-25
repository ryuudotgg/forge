import { confirm, isCancel } from "@clack/prompts";
import { z } from "zod/v4";
import { getUnsafeConfig, setConfig } from "../config";
import { cancel } from "../utils/cancel";

export const authenticationCustomUISchema = z.boolean();

async function getAuthenticationCustomUI(): Promise<void> {
	const { authentication } = getUnsafeConfig();
	if (authentication !== "WorkOS" && authentication !== "Clerk") return;

	const authenticationCustomUI = await confirm({
		message: `Do you want a custom UI for ${authentication}?`,
		active: "Yes",
		inactive: "No",
	});

	if (isCancel(authenticationCustomUI)) cancel();

	setConfig({ authenticationCustomUI });
}

export default getAuthenticationCustomUI;
