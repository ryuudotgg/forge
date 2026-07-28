import {
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { isUnknownCommand, parseCliArgs } from "../src/cli";
import {
	getSubcommand,
	type ParsedValues,
	type SubcommandDef,
} from "../src/commands/registry";
import { isEntryPoint, runCli } from "../src/index";

function parse(args: string[]) {
	return parseCliArgs(args);
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

interface TestCliOptions {
	readonly checkRuntime?: () => { ok: boolean; message: string };
	readonly defaultCommand: SubcommandDef;
	readonly getSubcommand?: (name: string) => SubcommandDef | undefined;
}

function createTestCli({
	checkRuntime = () => ({ ok: true, message: "Node.js v24" }),
	defaultCommand,
	getSubcommand = () => undefined,
}: TestCliOptions) {
	const error = vi.fn();
	const exit = vi.fn();
	const log = vi.fn();
	const printHelp = vi.fn();
	const setExitCode = vi.fn();
	const defaultEntry: readonly [string, SubcommandDef] = [
		"create",
		defaultCommand,
	];

	return {
		error,
		exit,
		log,
		printHelp,
		setExitCode,
		cli: {
			checkRuntime,
			defaultCommand: defaultEntry,
			error,
			exit,
			getSubcommand,
			log,
			printHelp,
			setExitCode,
		},
	};
}

function command(
	run: (positionals: string[], values: ParsedValues) => Promise<void>,
	overrides: Partial<SubcommandDef> = {},
): SubcommandDef {
	return {
		description: "Test command",
		run,
		...overrides,
	};
}

describe("CLI entry dispatch", () => {
	it("identifies an exact executable entry-point path", () => {
		const directory = mkdtempSync(
			join(realpathSync(tmpdir()), "forge-entrypoint-"),
		);
		const entryFile = join(directory, "entry.mjs");
		writeFileSync(entryFile, "");

		try {
			expect(isEntryPoint(pathToFileURL(entryFile).href, entryFile)).toBe(true);
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it("identifies a symlink to the executable entry point", () => {
		const directory = mkdtempSync(
			join(realpathSync(tmpdir()), "forge-entrypoint-"),
		);
		const entryFile = join(directory, "entry.mjs");
		const invokedPath = join(directory, "forge");
		writeFileSync(entryFile, "");
		symlinkSync(entryFile, invokedPath);

		try {
			expect(isEntryPoint(pathToFileURL(entryFile).href, invokedPath)).toBe(
				true,
			);
		} finally {
			rmSync(directory, { force: true, recursive: true });
		}
	});

	it("does not identify an undefined executable path", () => {
		expect(isEntryPoint(import.meta.url, undefined)).toBe(false);
	});

	it("does not identify a nonexistent executable path", () => {
		expect(isEntryPoint(import.meta.url, "/nonexistent/forge")).toBe(false);
	});

	it("runs the default create command for a bare invocation", async () => {
		const runCreate = vi.fn(
			async (
				_positionals: string[],
				_values: ParsedValues,
			): Promise<void> => {},
		);
		const testCli = createTestCli({
			defaultCommand: command(runCreate),
		});

		await runCli([], testCli.cli);

		expect(runCreate).toHaveBeenCalledWith([], {});
		expect(testCli.log).toHaveBeenCalledTimes(2);
	});

	it("runs a known subcommand with its positional arguments", async () => {
		const runCreate = vi.fn(
			async (
				_positionals: string[],
				_values: ParsedValues,
			): Promise<void> => {},
		);
		const runAdd = vi.fn(
			async (
				_positionals: string[],
				_values: ParsedValues,
			): Promise<void> => {},
		);
		const add = command(runAdd);
		const testCli = createTestCli({
			defaultCommand: command(runCreate),
			getSubcommand: (name) => (name === "add" ? add : undefined),
		});

		await runCli(["add", "drizzle"], testCli.cli);

		expect(runAdd).toHaveBeenCalledWith(["drizzle"], {});
		expect(runCreate).not.toHaveBeenCalled();
	});

	it("short-circuits help and version before dispatch", async () => {
		const runCreate = vi.fn(
			async (
				_positionals: string[],
				_values: ParsedValues,
			): Promise<void> => {},
		);
		const testCli = createTestCli({
			defaultCommand: command(runCreate),
		});

		await runCli(["--help"], testCli.cli);
		await runCli(["--version"], testCli.cli);

		expect(testCli.printHelp).toHaveBeenCalledOnce();
		expect(testCli.log).toHaveBeenCalledWith("We're on Forge v0.1.0");
		expect(testCli.exit).toHaveBeenNthCalledWith(1, 0);
		expect(testCli.exit).toHaveBeenNthCalledWith(2, 0);
		expect(runCreate).not.toHaveBeenCalled();
	});

	it("exits when a required command argument is missing", async () => {
		const runCreate = vi.fn(
			async (
				_positionals: string[],
				_values: ParsedValues,
			): Promise<void> => {},
		);
		const runAdd = vi.fn(
			async (
				_positionals: string[],
				_values: ParsedValues,
			): Promise<void> => {},
		);
		const add = command(runAdd, { arg: "[addon-id]", argRequired: true });
		const testCli = createTestCli({
			defaultCommand: command(runCreate),
			getSubcommand: (name) => (name === "add" ? add : undefined),
		});

		await runCli(["add"], testCli.cli);

		expect(testCli.error).toHaveBeenCalledWith("Usage: forge add [addon-id]");
		expect(testCli.exit).toHaveBeenCalledWith(1);
		expect(runAdd).not.toHaveBeenCalled();
	});

	it("reports runtime, option, command, and command-runner failures", async () => {
		const runCreate = vi.fn(
			async (
				_positionals: string[],
				_values: ParsedValues,
			): Promise<void> => {},
		);
		const runtimeCli = createTestCli({
			checkRuntime: () => ({ ok: false, message: "Unsupported runtime" }),
			defaultCommand: command(runCreate),
		});
		const optionCli = createTestCli({ defaultCommand: command(runCreate) });
		const unknownCli = createTestCli({ defaultCommand: command(runCreate) });
		const failure = new Error("Command failed");
		const failingCli = createTestCli({
			defaultCommand: command(async () => {
				throw failure;
			}),
		});

		await runCli([], runtimeCli.cli);
		await runCli(["--unknown"], optionCli.cli);
		await runCli(["unknown"], unknownCli.cli);
		await runCli([], failingCli.cli);

		expect(runtimeCli.error).toHaveBeenCalledWith("Unsupported runtime");
		expect(runtimeCli.exit).toHaveBeenCalledWith(1);
		expect(optionCli.setExitCode).toHaveBeenCalledWith(1);
		expect(unknownCli.setExitCode).toHaveBeenCalledWith(1);
		expect(failingCli.error).toHaveBeenCalledWith(failure);
		expect(failingCli.setExitCode).toHaveBeenCalledWith(1);
	});
});
