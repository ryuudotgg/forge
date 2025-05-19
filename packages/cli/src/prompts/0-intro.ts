import { intro } from "@clack/prompts";
import color from "picocolors";
import { version } from "../../package.json" with { type: "json" };

// We use this function to dynamically insert the version number into the banner
// while maintaining proper alignment of the ASCII Art.
function banner() {
	const snout = "| |                               '\\Y/'";

	const versionText = `v${version}`;

	const lineWidth = 70;
	const edgePadding = 3;

	const paddingLength =
		lineWidth - snout.length - versionText.length - edgePadding;

	const leftPadding = " ".repeat(Math.max(0, paddingLength));
	const rightPadding = " ".repeat(edgePadding);

	return console.log(
		color.red(`
                                  /   \\
 _                        )      ((   ))     (
(@)                      /|\\      ))_((     /|\\
|-|                     / | \\    (/\\|/\\)   / | \\                      (@)
| | -------------------/--|-voV---\\'|'/--Vov-|--\\---------------------|-|
|-|                         '^'   (o o)  '^'                          | |
${snout}${leftPadding}${color.gray(versionText)}${rightPadding}|-|
|-|                                                                   | |
| |                         ${color.bold(color.inverse("  RYUU'S FORGE  "))}                          |-|
|-|           ${color.dim("An all-in-one starter for your next big thing.")}          | |
| |                                                                   |-|
|-|___________________________________________________________________| |
(@)              l   /\\ /         ( (       \\ /\\   l                '\\|-|
                 l /   V           \\ \\       V   \\ l                  (@)
                 I/                _) )_          \\I
                                   '\\ /'
                                     V
    `),
	);
}

function printIntro(): void {
	banner();
	intro(color.inverse(" START THE FORGE "));
}

export default printIntro;
