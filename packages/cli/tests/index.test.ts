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
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { version } from "../package.json" with { type: "json" };
import {
	buildFlagOverrides,
	isParsedValues,
	isUnknownCommand,
	options,
	parseCliArgs,
	validateParsedArgs,
} from "../src/cli";
import {
	getSubcommand,
	type ParsedValues,
	type SubcommandDef,
} from "../src/commands/registry";
import { isEntryPoint, runCli } from "../src/index";
import { cliLayer, runCliEffect, withCliRuntime } from "../src/runtime";

function parse(args: string[]) {
	return parseCliArgs(args);
}

describe("CLI argument parsing", () => {
	it("accepts named secondary web app flags", () => {
		const { values, positionals } = parse([
			"add",
			"nextjs",
			"--name",
			"site",
			"--client",
			"--yes",
			"--no-install",
		]);

		expect(positionals).toEqual(["add", "nextjs"]);
		expect(values).toMatchObject({
			name: "site",
			client: true,
			yes: true,
			"no-install": true,
		});

		expect(buildFlagOverrides(values)).toEqual({ name: "site" });
	});

	it("accepts repeatable web flags without changing other flags", () => {
		const { values } = parse([
			"--web",
			"tanstack-router",
			"--web",
			"admin=nextjs",
			"--web",
			"docs=react-router",
			"--no-install",
		]);

		expect(values.web).toEqual([
			"tanstack-router",
			"admin=nextjs",
			"docs=react-router",
		]);

		expect(buildFlagOverrides(values)).toEqual({
			web: "tanstack-router",
			webApps: [
				{ name: "admin", framework: "nextjs" },
				{ name: "docs", framework: "react-router" },
			],
		});

		expect(values["no-install"]).toBe(true);
	});

	it("marks a named web app as an API client with +client", () => {
		expect(
			buildFlagOverrides(
				parse(["--web", "tanstack-router", "--web", "admin=nextjs+client"])
					.values,
			),
		).toEqual({
			web: "tanstack-router",
			webApps: [{ name: "admin", framework: "nextjs", client: true }],
		});

		expect(
			buildFlagOverrides(parse(["--web", "admin=nextjs+client"]).values),
		).toEqual({
			webApps: [{ name: "admin", framework: "nextjs", client: true }],
		});
	});

	const frameworkChoices =
		"nextjs, react-router, tanstack-router, or tanstack-start";

	it.each([
		["web=nextjs", "web is reserved. Pick another name for this web app."],
		[
			"server=nextjs",
			"server is reserved. Pick another name for this web app.",
		],
		[
			"Admin=nextjs",
			"Admin isn't a valid web app name. Start with a lowercase letter and use only lowercase letters, numbers and hyphens.",
		],
		[
			"admin=unknown",
			`unknown isn't a web framework. Use ${frameworkChoices}.`,
		],
		[
			"admin=",
			"--web admin= needs a framework after the equals sign, like admin=nextjs.",
		],
		[
			"=nextjs",
			"--web =nextjs needs a web app name before the equals sign, like admin=nextjs.",
		],
		[
			"admin=nextjs=other",
			`nextjs=other isn't a web framework. Use ${frameworkChoices}.`,
		],
		["unknown", `unknown isn't a web framework. Use ${frameworkChoices}.`],
		["", "--web needs a framework, like --web nextjs."],
		[
			"nextjs+client",
			"Only a named web app can be an API client, like admin=nextjs+client.",
		],
	])("rejects invalid web flag %j with a sentence", (entry, message) => {
		let thrown: unknown;
		try {
			buildFlagOverrides(parse(["--web", entry]).values);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect(thrown instanceof Error ? thrown.message : "").toBe(message);
	});

	it("rejects duplicate secondary names", () => {
		expect(() =>
			buildFlagOverrides(
				parse(["--web", "admin=nextjs", "--web", "admin=react-router"]).values,
			),
		).toThrow(/^admin is used by more than one web app\.$/);
	});

	it("refuses two bare frameworks instead of keeping the last", () => {
		expect(() =>
			buildFlagOverrides(
				parse(["--web", "nextjs", "--web", "react-router"]).values,
			),
		).toThrow(
			/^--web takes one bare framework for the primary web app, but got nextjs and react-router\. Name the others, like admin=react-router\.$/,
		);
	});

	it("rejects a boolean web override", () => {
		expect(() => buildFlagOverrides({ web: true })).toThrow(
			"CLI Args Invalid: web must contain frameworks or name=framework entries.",
		);
	});

	it("keeps legacy string flags and normalizes framework aliases", () => {
		expect(buildFlagOverrides({ web: "Next.js" })).toEqual({ web: "nextjs" });
		expect(
			buildFlagOverrides(parse(["--web", "admin=Next.js"]).values),
		).toEqual({ webApps: [{ name: "admin", framework: "nextjs" }] });

		expect(buildFlagOverrides({})).toEqual({});
	});

	it("accepts only string arrays on the repeatable web option", () => {
		expect(isParsedValues({ web: ["nextjs"] })).toBe(true);
		expect(isParsedValues({ web: [42] })).toBe(false);
		expect(isParsedValues({ name: ["project"] })).toBe(false);
	});

	it("accepts string arrays exactly on the options marked multiple", () => {
		for (const [key, option] of Object.entries(options))
			expect(isParsedValues({ [key]: ["value"] })).toBe(
				"multiple" in option && option.multiple,
			);
	});

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

	it("rejects malformed parser output at the runtime boundary", () => {
		expect(isParsedValues(null)).toBe(false);
		expect(isParsedValues("not-an-object")).toBe(false);
		expect(isParsedValues({ name: 42 })).toBe(false);
		expect(() =>
			validateParsedArgs({ positionals: [], values: { name: 42 } }),
		).toThrow("CLI Args Invalid: option values must be strings or booleans.");
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
				"--keep-user",
				"--accept-forge",
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

interface RuntimeProbeService {
	readonly ready: true;
}

class RuntimeProbe extends Context.Service<RuntimeProbe, RuntimeProbeService>()(
	"RuntimeProbe",
) {}

function runtimeWithProbe(construct: () => void, dispose: () => void) {
	const service = Layer.effect(
		RuntimeProbe,
		Effect.acquireRelease(
			Effect.sync(() => {
				construct();
				return { ready: true } satisfies RuntimeProbeService;
			}),
			() => Effect.sync(dispose),
		),
	);

	const probe = Layer.effectDiscard(RuntimeProbe.use(() => Effect.void)).pipe(
		Layer.provide(service),
	);

	return ManagedRuntime.make(Layer.merge(cliLayer, probe));
}

describe("CLI entry dispatch", () => {
	it("constructs services once and disposes them after a command", async () => {
		const construct = vi.fn();
		const dispose = vi.fn();
		const runtime = runtimeWithProbe(construct, dispose);

		await withCliRuntime(async () => {
			await runCliEffect(Effect.void);
			await runCliEffect(Effect.void);
		}, runtime);

		expect(construct).toHaveBeenCalledOnce();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("disposes the runtime when a command throws", async () => {
		const dispose = vi.fn();
		const runtime = runtimeWithProbe(() => {}, dispose);

		await expect(
			withCliRuntime(async () => {
				await runCliEffect(Effect.void);
				throw new Error("prompt cancelled");
			}, runtime),
		).rejects.toThrow("prompt cancelled");

		expect(dispose).toHaveBeenCalledOnce();
	});

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

	it("rejects mutually exclusive resolution flags", async () => {
		const runCreate = vi.fn(async (): Promise<void> => {});
		const testCli = createTestCli({
			defaultCommand: command(runCreate),
		});

		await runCli(["--keep-user", "--accept-forge"], testCli.cli);

		expect(testCli.error).toHaveBeenCalledWith(
			"You can't use --keep-user and --accept-forge together.",
		);

		expect(testCli.setExitCode).toHaveBeenCalledWith(1);
		expect(runCreate).not.toHaveBeenCalled();
	});

	it("does not add surrounding output to JSON commands", async () => {
		const runCreate = vi.fn(async (): Promise<void> => {});
		const runList = vi.fn(async (): Promise<void> => {});
		const list = command(runList, { machineOutput: true });
		const testCli = createTestCli({
			defaultCommand: command(runCreate),
			getSubcommand: (name) => (name === "list" ? list : undefined),
		});

		await runCli(["list", "--json"], testCli.cli);

		expect(runList).toHaveBeenCalledWith([], { json: true });
		expect(testCli.log).not.toHaveBeenCalled();
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
		expect(testCli.log).toHaveBeenCalledWith(`We're on Forge v${version}`);
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

		expect(failingCli.error).toHaveBeenCalledWith("Command failed");
		expect(failingCli.setExitCode).toHaveBeenCalledWith(1);
	});
});
