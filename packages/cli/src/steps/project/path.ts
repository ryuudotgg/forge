import { existsSync, readdirSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { isCancel, log, text } from "@clack/prompts";
import { formatSchemaError } from "@ryuugg/core";
import { Result, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { listAnd } from "../../utils/list";
import { defineStep, SKIP } from "../types";

export const pathSchema = Schema.Trim.pipe(
	Schema.check(
		Schema.isMinLength(1, { message: "You need to provide a path." }),
		Schema.isPattern(/^(\.\/.*|\.)$/, {
			message: "You need to provide a relative path.",
		}),
		Schema.makeFilter(
			(value) => {
				const normalized = normalize(value);
				return normalized !== ".." && !normalized.startsWith("..");
			},
			{ message: "You need to provide a path inside the current directory." },
		),
	),
);

export type PathTarget = "new" | "existing";

const shownEntryLimit = 3;

function readEntries(path: string) {
	try {
		return statSync(path).isDirectory() ? readdirSync(path).sort() : "file";
	} catch {
		return "unreadable";
	}
}

export function occupiedTargetIssue(path: string): string | undefined {
	if (!existsSync(path)) return;

	const target =
		normalize(path) === "." ? "The current directory" : `"${path}"`;

	const entries = readEntries(path);
	if (entries === "file")
		return `${target} is a file, so we can't create your project there. Pick another path.`;

	if (entries === "unreadable")
		return `${target} can't be read, so we can't create your project there. Pick another path.`;

	if (entries.length === 0) return;

	if (existsSync(join(path, ".forge", "manifest.json")))
		return `${target} already holds a Forge project. Run forge add or forge update inside it instead.`;

	const shown =
		entries.length > shownEntryLimit
			? [
					...entries.slice(0, shownEntryLimit),
					`${entries.length - shownEntryLimit} more`,
				]
			: entries;

	return `${target} already holds ${listAnd.format(shown)}. Pick a new or empty directory, or run forge init inside it to adopt your project.`;
}

function pathIssue(value: unknown, target: PathTarget) {
	const result = Schema.decodeUnknownResult(pathSchema)(value);
	if (Result.isFailure(result))
		return (
			formatSchemaError(result.failure)[0]?.message ??
			"You need to provide a valid path."
		);

	if (target === "new") return occupiedTargetIssue(result.success);
}

export function createPathStep(target: PathTarget) {
	return defineStep<string>({
		id: "path",
		group: "project",
		schema: pathSchema,
		configKey: "path",

		dependencies: ["name"],

		shouldRun: () => true,

		validate(value) {
			const issue = pathIssue(value, target);
			if (issue === undefined) return;

			log.error(issue);
			process.exit(1);
		},

		async execute(config, interactive) {
			const slug = config.slug ?? "my-app";
			if (!interactive) {
				const value = config.path ?? `./${slug}`;

				const result = Schema.decodeResult(pathSchema)(value);
				if (Result.isFailure(result)) return SKIP;

				const issue =
					target === "new" ? occupiedTargetIssue(result.success) : undefined;

				if (issue !== undefined) {
					log.error(issue);
					process.exit(1);
				}

				return result.success;
			}

			const defaultValue = `./${slug}`;

			const path = await text({
				message: "Where do you want us to create your project?",
				defaultValue,
				placeholder: defaultValue,
				validate: (value) => pathIssue(value || defaultValue, target),
			});

			if (isCancel(path)) cancel();

			return path;
		},
	});
}

export default createPathStep("new");
