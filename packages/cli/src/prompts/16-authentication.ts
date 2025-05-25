import { isCancel, select } from "@clack/prompts";
import { z } from "zod/v4";
import { setConfig } from "../config";
import { cancel } from "../utils/cancel";

const authenticationOptions = [
	"Better Auth",
	"Auth.js",
	"WorkOS",
	"Clerk",
	"None",
] as const;

export const authenticationSchema = z.enum(
	authenticationOptions.filter((authentication) => authentication !== "None"),
);

async function getAuthentication(): Promise<void> {
	const authentication = await select({
		message: "What is your preferred way to handle authentication?",
		options: authenticationOptions.map((authentication) => ({
			label: authentication,
			value: authentication,
		})),
	});

	if (isCancel(authentication)) cancel();
	if (authentication !== "None") setConfig({ authentication });
}

export default getAuthentication;
