import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { CreateFile } from "@ryuujs/core";
import { filePath } from "@ryuujs/core";
import { Array as Arr, pipe } from "effect";

const __filename = fileURLToPath(import.meta.url);

const PKG_ROOT = join(dirname(__filename), "..");
const TEMPLATE_DIR = join(PKG_ROOT, "templates");

function collectFiles(dir: string): ReadonlyArray<string> {
	const entries = readdirSync(dir);
	const files: string[] = [];

	for (const entry of entries) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) files.push(...collectFiles(full));
		else files.push(full);
	}

	return files;
}

export function templateFiles(
	templatePath: string,
	outputPrefix: string,
): ReadonlyArray<CreateFile> {
	const templateDir = join(TEMPLATE_DIR, templatePath);
	const files = collectFiles(templateDir);

	return pipe(
		files,
		Arr.map(
			(file): CreateFile => ({
				_tag: "CreateFile",
				path: filePath(`${outputPrefix}/${relative(templateDir, file)}`),
				content: readFileSync(file, "utf-8"),
			}),
		),
	);
}

export function readTemplate(templatePath: string): string {
	return readFileSync(join(TEMPLATE_DIR, templatePath), "utf-8");
}

export function interpolate(
	template: string,
	vars: Record<string, string>,
): string {
	return Object.entries(vars).reduce(
		(result, [key, value]) => result.replaceAll(`__${key}__`, value),
		template,
	);
}
