import { confirm, isCancel } from "@clack/prompts";
import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

function gitInit(dir: string) {
	return Effect.gen(function* () {
		yield* Command.string(
			Command.make("git", "init").pipe(Command.workingDirectory(dir)),
		);
		yield* Command.string(
			Command.make("git", "add", "-A").pipe(Command.workingDirectory(dir)),
		);
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
			await Effect.runPromise(gitInit(dir));
			return SKIP;
		}

		const shouldInit = await confirm({
			message: "Do you want to initialize a git repository?",
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(shouldInit)) cancel();
		if (!shouldInit) return SKIP;

		await Effect.runPromise(gitInit(dir));
	},
});

export default gitInitStep;
