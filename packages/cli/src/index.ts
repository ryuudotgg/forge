import fs from "node:fs/promises";
import path from "node:path";

try {
	console.log();

	const prompts = await fs.readdir(path.join(import.meta.dirname, "./prompts"));
	const validPrompts = prompts
		.filter((file) => /^\d+-[a-zA-Z0-9-]+\.(js|ts)$/.test(file))
		.sort((a, b) => {
			const numA = Number(a.split("-")[0] || "0") || 0;
			const numB = Number(b.split("-")[0] || "0") || 0;

			return numA - numB;
		});

	for (const prompt of validPrompts) {
		const module = await import(`./prompts/${prompt}`);
		await module.default?.();
	}

	console.log();
} catch (error) {
	console.error(error);
}
