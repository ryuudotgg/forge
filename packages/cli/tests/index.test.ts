import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isUnknownCommand } from "../src/cli";
import { getSubcommand } from "../src/commands/registry";

const cliPath = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

function runCli(args: string[]) {
	return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

describe("CLI argument parsing", () => {
	it("uses create for a bare invocation and rejects unknown commands", () => {
		expect(isUnknownCommand(undefined, undefined)).toBe(false);
		expect(
			isUnknownCommand("definitely-not-a-command", getSubcommand("bogus")),
		).toBe(true);
	});

	it("rejects unknown options with a helpful error", () => {
		const result = runCli(["--no-such-flag"]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"We don't recognize that option. Run forge --help to see the available flags.",
		);
		expect(result.stderr).not.toContain("node:internal");
	});

	it("rejects unknown commands with a helpful error", () => {
		const result = runCli(["definitely-not-a-command"]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"We don't recognize that command. Run forge --help to see what forge can do.",
		);
	});

	it("accepts help and currently valid flags", () => {
		const result = runCli([
			"--config",
			"forge.config.json",
			"--preset",
			"default",
			"--no-install",
			"--no-git",
			"--web",
			"nextjs",
			"--help",
		]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("--no-install");
		expect(result.stdout).not.toContain("--accept-incoming");
	});
});
