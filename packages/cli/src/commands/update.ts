import { intro } from "@clack/prompts";
import { failLifecycleCommand } from "./lifecycle";

export async function runUpdate(
	_values: Record<string, string | boolean | undefined>,
) {
	intro("We're updating your project...");
	await failLifecycleCommand(".", "update");
}
