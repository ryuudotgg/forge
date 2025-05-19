import { cancel as clackCancel } from "@clack/prompts";

export function cancel(message?: string, code: 0 | 1 = 0): never {
	clackCancel(message ?? "You've extinguished the forge.");
	process.exit(code);
}
