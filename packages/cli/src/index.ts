import { parseArgs } from "node:util";
import { checkRuntime } from "@ryuujs/core";
import { version } from "../package.json" with { type: "json" };
import { getParseArgsOptions, isUnknownCommand } from "./cli";
import { defaultCommand, getSubcommand } from "./commands/registry";
import { printHelp } from "./utils/help";

const runtimeCheck = checkRuntime();
if (!runtimeCheck.ok) {
	console.error(runtimeCheck.message);
	process.exit(1);
}

const parsed = (() => {
	try {
		return parseArgs({
			options: getParseArgsOptions(),
			allowPositionals: true,
			strict: true,
		});
	} catch {
		console.error(
			"We don't recognize that option. Run forge --help to see the available flags.",
		);

		process.exitCode = 1;
	}
})();

if (parsed) {
	const { values, positionals } = parsed;

	if (values.help) {
		printHelp();
		process.exit(0);
	}

	if (values.version) {
		console.log(`We're on Forge v${version}`);
		process.exit(0);
	}

	const subcommand = positionals[0];
	const cmd = subcommand ? getSubcommand(subcommand) : undefined;

	try {
		if (isUnknownCommand(subcommand, cmd)) {
			console.error(
				"We don't recognize that command. Run forge --help to see what forge can do.",
			);

			process.exitCode = 1;
		} else {
			console.log();

			if (cmd) {
				const args = positionals.slice(1);
				if (cmd.arg && cmd.argRequired && args.length === 0) {
					console.error(`Usage: forge ${subcommand} ${cmd.arg}`);
					process.exit(1);
				}

				await cmd.run(args, values);
			} else {
				const [, defaultCmd] = defaultCommand;
				await defaultCmd.run(positionals, values);
			}

			console.log();
		}
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
