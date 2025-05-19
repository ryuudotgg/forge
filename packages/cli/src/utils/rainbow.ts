import color from "picocolors";

/**
 * It'll generate rainbow-colored text.
 */
export function rainbow(text: string): string {
	const colors = [
		color.red,
		color.magenta,
		color.blue,
		color.green,
		color.yellow,
	];

	return text
		.split("")
		.map((char, i) => {
			const colorFn = colors[i % colors.length];
			return colorFn ? colorFn(char) : char;
		})
		.join("");
}
