import { intro } from "@clack/prompts";
import { failLifecycleCommand } from "./lifecycle";

export async function runAdd(
	generatorId: string,
	_values: Record<string, string | boolean | undefined>,
) {
	intro(`Adding ${generatorId}...`);
	await failLifecycleCommand(".", "add");
}
