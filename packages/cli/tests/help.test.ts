import { describe, expect, it, vi } from "vitest";
import { options } from "../src/cli";
import { printHelp } from "../src/utils/help";

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
	return text.replace(ansiPattern, "");
}

function captureHelp(): string[] {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	try {
		printHelp();

		return logSpy.mock.calls.map((call) =>
			stripAnsi(call.map(String).join(" ")),
		);
	} finally {
		logSpy.mockRestore();
	}
}

describe("printHelp", () => {
	it("documents the usage line and every subcommand", () => {
		const output = captureHelp().join("\n");

		expect(output).toContain("forge [command] [options]");
		expect(output).toContain("forge update");
		expect(output).toContain("forge add [addon-id]");
		expect(output).toContain("forge remove [addon-id]");

		const createLine = captureHelp().find((line) =>
			line.includes(
				"Forge a new project from a framework, template, and addons.",
			),
		);

		expect(createLine).toBeDefined();
		expect(createLine).toMatch(/^ {4}forge {2,}Forge a new project/);
	});

	it("documents every option as a long flag", () => {
		const output = captureHelp().join("\n");

		for (const key of Object.keys(options))
			expect(output).toContain(`--${key}`);
	});

	it("aligns the description column across commands and flags", () => {
		const lines = captureHelp();

		const descriptions = [
			"Add an addon to your project.",
			"Reconcile your installed addons and templates.",
			"Use a JSON Config File.",
			"Do not initialize a Git repository.",
		];

		const columns = descriptions.map((description) => {
			const line = lines.find((entry) => entry.includes(description));

			expect(line).toBeDefined();
			return line?.indexOf(description);
		});

		expect(new Set(columns).size).toBe(1);
	});

	it("colorizes value lists with middle dot separators", () => {
		const output = captureHelp().join("\n");

		expect(output).toContain("Node.js · Bun · Deno");
		expect(output).toContain("Next.js · Convex · Hono · Elysia · etc.");
	});

	it("keeps parenthetical hints attached to their value", () => {
		const output = captureHelp().join("\n");

		expect(output).toContain("Flat · Scoped (pnpm only)");
	});
});
