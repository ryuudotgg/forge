import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { getParseArgsOptions, isUnknownCommand } from "../src/cli";
import { getSubcommand } from "../src/commands/registry";

function parse(args: string[]) {
	return parseArgs({
		options: getParseArgsOptions(),
		allowPositionals: true,
		strict: true,
		args,
	});
}

describe("CLI argument parsing", () => {
	it("classifies a bare invocation, known commands, and unknown commands", () => {
		expect(isUnknownCommand(undefined, undefined)).toBe(false);
		expect(isUnknownCommand("add", getSubcommand("add"))).toBe(false);
		expect(
			isUnknownCommand("definitely-not-a-command", getSubcommand("bogus")),
		).toBe(true);
	});

	it("rejects unknown options under strict parsing", () => {
		expect(() => parse(["--no-such-flag"])).toThrow();
	});

	it("no longer accepts the removed accept-incoming flag", () => {
		expect(() => parse(["--accept-incoming"])).toThrow();
	});

	it("accepts every currently valid flag", () => {
		expect(() =>
			parse([
				"--config",
				"forge.config.json",
				"--preset",
				"default",
				"--no-install",
				"--no-git",
				"--web",
				"nextjs",
			]),
		).not.toThrow();

		const { values } = parse(["--config", "x.json", "--no-install"]);
		expect(values.config).toBe("x.json");
		expect(values["no-install"]).toBe(true);
	});
});
