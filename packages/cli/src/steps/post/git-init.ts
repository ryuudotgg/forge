import { confirm, isCancel, text } from "@clack/prompts";
import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

const DEFAULT_MESSAGE = "chore: initialize repository via forge";

function gitInit(dir: string, message: string) {
	return Effect.gen(function* () {
		yield* Command.string(
			Command.make("git", "init").pipe(Command.workingDirectory(dir)),
		);

		yield* Command.string(
			Command.make("git", "add", "-A").pipe(Command.workingDirectory(dir)),
		);

		const sha = yield* Command.string(
			Command.make("git", "commit", "-m", message).pipe(
				Command.workingDirectory(dir),
			),
		);

		return sha.trim();
	}).pipe(Effect.provide(NodeContext.layer));
}

const gitInitStep = defineStep({
	id: "gitInit",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		const dir = String(config.path);

		if (!interactive) {
			await Effect.runPromise(gitInit(dir, DEFAULT_MESSAGE));
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

		await Effect.runPromise(gitInit(dir, message || DEFAULT_MESSAGE));
	},
});

export default gitInitStep;
