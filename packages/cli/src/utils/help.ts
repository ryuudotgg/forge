import color from "picocolors";
import { type OptionKey, options, sections } from "../cli";
import { type SubcommandDef, subcommands } from "../commands/registry";

interface HelpEntry {
	label: string;
	rawLen: number;
	description: string;
}

function buildCommandEntries(): HelpEntry[] {
	const entries: HelpEntry[] = [];

	for (const [name, cmd] of Object.entries<SubcommandDef>(subcommands)) {
		const label = cmd.default ? "forge" : `forge ${name}`;

		if (cmd.arg) {
			entries.push({
				label: `${color.cyan(label)} ${color.dim(cmd.arg)}`,
				rawLen: label.length + 1 + cmd.arg.length,
				description: cmd.description,
			});
		} else {
			entries.push({
				label: color.cyan(label),
				rawLen: label.length,
				description: cmd.description,
			});
		}
	}

	return entries;
}

function formatFlag(key: OptionKey): string {
	const opt = options[key];

	const short = "short" in opt ? color.dim(`-${opt.short}, `) : "    ";
	const long = `--${key}`;
	const arg = opt.type === "string" ? color.dim(" <value>") : "";

	return `${short}${color.white(long)}${arg}`;
}

function flagLength(key: OptionKey): number {
	const opt = options[key];

	const short = "short" in opt ? 4 : 4;
	const long = `--${key}`.length;
	const arg = opt.type === "string" ? 8 : 0;

	return short + long + arg;
}

function line(width: number) {
	console.log(`  ${color.gray("\u2500".repeat(width))}`);
}

function formatValues(description: string): string {
	const parts = description.split(", ");

	return parts
		.map((part) => {
			if (part === "etc.") return color.dim(part);

			const parenIdx = part.indexOf(" (");
			if (parenIdx !== -1)
				return (
					color.white(part.slice(0, parenIdx)) +
					color.dim(` ${part.slice(parenIdx + 1)}`)
				);

			return color.white(part);
		})
		.join(color.dim(" \u00b7 "));
}

export function printHelp() {
	const commandEntries = buildCommandEntries();
	const allKeys = sections.flatMap((s) => s.keys);

	const maxLen = Math.max(
		...allKeys.map(flagLength),
		...commandEntries.map((c) => c.rawLen),
	);

	const allDescriptions = [
		...commandEntries.map((c) => c.description),
		...allKeys.map((k) => options[k].description),
	];

	const lineWidth = Math.max(
		...allDescriptions.map((d) => maxLen + 4 + d.length + 2),
	);

	console.log();
	console.log(
		`  ${color.bold(color.red("forge"))} ${color.dim("[command] [options]")}`,
	);

	line(lineWidth);

	console.log(`  ${color.bold("Commands")}`);

	for (const entry of commandEntries) {
		const padding = " ".repeat(maxLen - entry.rawLen + 4);
		console.log(`    ${entry.label}${padding}${color.dim(entry.description)}`);
	}

	for (const section of sections) {
		line(lineWidth);
		console.log(`  ${color.bold(section.title)}`);

		for (const key of section.keys) {
			const opt = options[key];

			const flag = formatFlag(key);
			const len = flagLength(key);
			const padding = " ".repeat(maxLen - len + 4);

			const desc =
				"configKey" in opt || "isValueList" in opt
					? formatValues(opt.description)
					: color.dim(opt.description);

			console.log(`    ${flag}${padding}${desc}`);
		}
	}

	console.log();
}
