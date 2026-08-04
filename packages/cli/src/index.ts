import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkRuntime, type EnvironmentCheck } from "@ryuujs/core";
import { version } from "../package.json" with { type: "json" };
import { isUnknownCommand, parseCliArgs } from "./cli";
import {
	defaultCommand,
	getSubcommand,
	type SubcommandDef,
} from "./commands/registry";
import { printHelp } from "./utils/help";

interface CliDependencies {
	readonly checkRuntime: () => EnvironmentCheck;
	readonly defaultCommand: readonly [string, SubcommandDef];
	readonly error: (message: unknown) => void;
	readonly exit: (code?: number) => void;
	readonly getSubcommand: (name: string) => SubcommandDef | undefined;
	readonly log: (message?: unknown) => void;
	readonly printHelp: () => void;
	readonly setExitCode: (code: number) => void;
}

const dependencies: CliDependencies = {
	checkRuntime,
	defaultCommand,
	error: console.error,
	exit: process.exit,
	getSubcommand,
	log: console.log,
	printHelp,
	setExitCode: (code) => {
		process.exitCode = code;
	},
};

export function isEntryPoint(
	entrypoint: string,
	invokedPath: string | undefined,
): boolean {
	if (!invokedPath) return false;

	try {
		return realpathSync(invokedPath) === fileURLToPath(entrypoint);
	} catch {
		return false;
	}
}

export async function runCli(
	args: readonly string[],
	cli: CliDependencies = dependencies,
): Promise<void> {
	const runtimeCheck = cli.checkRuntime();
	if (!runtimeCheck.ok) {
		cli.error(runtimeCheck.message);
		cli.exit(1);
		return;
	}

	let parsed: ReturnType<typeof parseCliArgs>;
	try {
		parsed = parseCliArgs(args);
	} catch {
		cli.error(
			"We don't recognize that option. Run forge --help to see the available flags.",
		);

		cli.setExitCode(1);

		return;
	}

	const { values, positionals } = parsed;

	if (values.help) {
		cli.printHelp();
		cli.exit(0);
		return;
	}

	if (values.version) {
		cli.log(`We're on Forge v${version}`);
		cli.exit(0);
		return;
	}

	if (values["keep-user"] === true && values["accept-forge"] === true) {
		cli.error("You can't use --keep-user and --accept-forge together.");
		cli.setExitCode(1);
		return;
	}

	const subcommand = positionals[0];
	const cmd = subcommand ? cli.getSubcommand(subcommand) : undefined;

	try {
		if (isUnknownCommand(subcommand, cmd)) {
			cli.error(
				"We don't recognize that command. Run forge --help to see what forge can do.",
			);

			cli.setExitCode(1);
			return;
		}

		const command = cmd ?? cli.defaultCommand[1];
		const commandArgs = cmd ? positionals.slice(1) : positionals;

		const machineOutput = command.machineOutput && values.json === true;
		if (!machineOutput) cli.log();

		if (command.arg && command.argRequired && commandArgs.length === 0) {
			cli.error(`Usage: forge ${subcommand} ${command.arg}`);
			cli.exit(1);
			return;
		}

		await command.run(commandArgs, values);
		if (!machineOutput) cli.log();
	} catch (error) {
		cli.error(error);
		cli.setExitCode(1);
	}
}

if (isEntryPoint(import.meta.url, process.argv[1]))
	await runCli(process.argv.slice(2));
