import { intro } from "@clack/prompts";
import { failLifecycleCommand } from "./lifecycle";

export async function runRemove(
	generatorId: string,
	_values: Record<string, string | boolean | undefined>,
) {
	intro(`We're removing "${generatorId}"...`);
	await failLifecycleCommand(".", "remove");
}
