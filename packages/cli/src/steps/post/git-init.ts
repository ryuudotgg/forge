import { confirm, isCancel, log, text } from "@clack/prompts";
import { LONG_RUNNING_TIMEOUT_MS, Subprocess } from "@ryuujs/core";
import { Cause, Effect, Exit, Option } from "effect";
import { runCliEffect } from "../../runtime";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const DEFAULT_MESSAGE = "chore: initialize repository via forge";

function gitInit(dir: string, message: string) {
	return Effect.gen(function* () {
		const runGit = (args: ReadonlyArray<string>) =>
			Subprocess.run({
				command: "git",
				args,
				cwd: dir,
				timeoutMs: LONG_RUNNING_TIMEOUT_MS,
				outputMode: "capture",
			});

		yield* runGit(["init"]);
		yield* runGit(["add", "-A"]);

		const commit = yield* runGit(["commit", "-m", message]);
		return commit.output.trim();
	});
}

async function runGitInit(dir: string, message: string) {
	const exit = await runCliEffect(gitInit(dir, message));

	if (Exit.isFailure(exit)) {
		if (Option.isNone(Cause.findErrorOption(exit.cause)))
			console.error(Cause.squash(exit.cause));

		log.warn(
			"We couldn't create the initial commit, so set up git yourself when you're ready.",
		);
	}
}

const gitInitStep = defineStep({
	id: "gitInit",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		if (config.gitInit === false) return SKIP;

		const dir = String(config.path);

		if (!interactive) {
			await runGitInit(dir, DEFAULT_MESSAGE);
			return SKIP;
		}

		const shouldInit = await confirm({
			message: "Do you want to initialize a Git Repository?",
			active: "Yes & Modify Message (Recommended)",
			inactive: "No",
		});

		if (isCancel(shouldInit)) cancel();
		if (!shouldInit) return SKIP;

		const message = await text({
			message: "What should the commit message be?",
			defaultValue: DEFAULT_MESSAGE,
			placeholder: DEFAULT_MESSAGE,
		});

		if (isCancel(message)) cancel();

		await runGitInit(dir, message || DEFAULT_MESSAGE);
	},
});

export default gitInitStep;
