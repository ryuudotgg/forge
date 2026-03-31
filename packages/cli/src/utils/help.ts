import color from "picocolors";
import { type OptionKey, options, sections } from "../cli";

function formatFlag(key: OptionKey): string {
	const opt = options[key];

	const short = "short" in opt ? `-${opt.short}, ` : "    ";
	const arg = opt.type === "string" ? " <value>" : "";

	return `${short}--${key}${arg}`;
}

export function printHelp() {
	const allKeys = sections.flatMap((s) => s.keys);
	const allFlags = allKeys.map(formatFlag);
	const maxLen = Math.max(...allFlags.map((f) => f.length));

	console.log();
	console.log(
		`  ${color.bold("Usage:")} ${color.cyan("forge")} ${color.dim("[options]")}`,
	);

	for (const section of sections) {
		console.log();
		console.log(`  ${color.bold(section.title)}`);

		for (const key of section.keys) {
			const opt = options[key];

			const flag = formatFlag(key);
			const padding = " ".repeat(maxLen - flag.length + 2);

			console.log(
				`    ${color.green(flag)}${padding}${color.dim(opt.description)}`,
			);
		}
	}

	console.log();
}
