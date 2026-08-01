import { log } from "@clack/prompts";
import { platforms } from "@ryuujs/generators";
import color from "picocolors";
import { type OptionKey, options, sections } from "../cli";
import { type SubcommandDef, subcommands } from "../commands/registry";

interface HelpEntry {
	label: string;
	rawLen: number;
	description: string;
}

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function visibleLength(value: string): number {
	return value.replace(ansiPattern, "").length;
}

function buildCommandEntries(): HelpEntry[] {
	const entries: HelpEntry[] = [];

	for (const [name, cmd] of Object.entries<SubcommandDef>(subcommands)) {
		const label = cmd.default ? "forge [create]" : `forge ${name}`;
		const command = color.bold(color.cyan(label));

		if (cmd.arg)
			entries.push({
				label: `${command} ${color.dim(cmd.arg)}`,
				rawLen: label.length + 1 + cmd.arg.length,
				description: cmd.description,
			});
		else
			entries.push({
				label: command,
				rawLen: label.length,
				description: cmd.description,
			});
	}

	return entries;
}

function isPlatformUnavailable(key: OptionKey) {
	const opt = options[key];
	return "platform" in opt && !platforms.available(opt.platform);
}

function formatFlag(key: OptionKey, unavailable: boolean): string {
	const opt = options[key];

	const short =
		"short" in opt
			? unavailable
				? `-${opt.short}, `
				: `${color.bold(`-${opt.short}`)}, `
			: "    ";
	const long = `--${key}`;
	const arg =
		opt.type === "string"
			? unavailable
				? " <value>"
				: color.dim(" <value>")
			: "";
	const soon = unavailable ? color.dim(" (soon)") : "";

	return `${short}${unavailable ? long : color.bold(long)}${arg}${soon}`;
}

function flagLength(key: OptionKey): number {
	return visibleLength(formatFlag(key, isPlatformUnavailable(key)));
}

function formatChoices(key: OptionKey, unavailable: boolean): string {
	const opt = options[key];
	const choices = "choices" in opt ? opt.choices : [];

	return choices
		.map((choice) =>
			unavailable
				? choice.label
				: choice.available
					? color.white(choice.label)
					: color.dim(`${choice.label} (soon)`),
		)
		.join(unavailable ? " \u00b7 " : color.dim(" \u00b7 "));
}

export function printHelp() {
	const commandEntries = buildCommandEntries();
	const allKeys = sections.flatMap((s) => s.keys);

	const maxLen = Math.max(
		...allKeys.map(flagLength),
		...commandEntries.map((c) => c.rawLen),
	);

	const lines = [
		`  ${color.bold(color.red("Usage:"))} ${color.bold("forge")} ${color.dim("[command] [options]")}`,
		"",
		`  ${color.bold(color.cyan("Commands"))}`,
	];

	for (const entry of commandEntries) {
		const padding = " ".repeat(maxLen - entry.rawLen + 4);
		lines.push(`    ${entry.label}${padding}${color.dim(entry.description)}`);
	}

	for (const section of sections) {
		lines.push("", `  ${color.bold(color.cyan(section.title))}`);

		for (const key of section.keys) {
			const opt = options[key];
			const unavailable = isPlatformUnavailable(key);

			const flag = formatFlag(key, unavailable);
			const len = flagLength(key);
			const padding = " ".repeat(maxLen - len + 4);

			const desc =
				"choices" in opt
					? formatChoices(key, unavailable)
					: color.dim(opt.description);

			const row = `    ${flag}${padding}${desc}`;
			lines.push(unavailable ? color.dim(row) : row);
		}
	}

	lines.push(
		"",
		`  ${color.bold(color.cyan("Examples"))}`,
		`    ${color.bold("forge list")} ${color.dim("auth")}`,
		`    ${color.bold("forge info")} ${color.dim("drizzle")}`,
		`    ${color.bold("forge add")} ${color.dim("trpc")}`,
	);

	log.message(`${lines.join("\n")}\n`);
}
