import { parseArgs } from "node:util";
import { version } from "../package.json" with { type: "json" };
import { getParseArgsOptions } from "./cli";
import {
	defaultCommand,
	type SubcommandDef,
	type SubcommandName,
	subcommands,
} from "./commands/registry";
import { printHelp } from "./utils/help";

const { values, positionals } = parseArgs({
	options: getParseArgsOptions(),
	allowPositionals: true,
	strict: false,
});

if (values.help) {
	printHelp();
	process.exit(0);
}

if (values.version) {
	console.log(`We're on Forge v${version}`);
	process.exit(0);
}

const subcommand = positionals[0];

try {
	console.log();

	if (subcommand && subcommand in subcommands) {
		const cmd: SubcommandDef = subcommands[subcommand as SubcommandName];
		const args = positionals.slice(1);

		if (cmd.arg && args.length === 0) {
			console.error(`Usage: forge ${subcommand} ${cmd.arg}`);
			process.exit(1);
		}

		await cmd.run(args, values);
	} else {
		const [, cmd] = defaultCommand;
		await cmd.run(positionals, values);
	}

	console.log();
} catch (error) {
	console.error(error);
}
