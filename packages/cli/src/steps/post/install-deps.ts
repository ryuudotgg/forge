import { confirm, isCancel } from "@clack/prompts";
import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

function installDeps(pm: string, dir: string) {
	return Command.exitCode(
		Command.make(pm, "install").pipe(
			Command.workingDirectory(dir),
			Command.stdout("inherit"),
			Command.stderr("inherit"),
		),
	).pipe(Effect.provide(NodeContext.layer));
}

const installDepsStep = defineStep({
	id: "installDeps",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		const pm = String(config.packageManager ?? "pnpm");
		const dir = String(config.path);

		if (!interactive) {
			await Effect.runPromise(installDeps(pm, dir));
			return SKIP;
		}

		const shouldInstall = await confirm({
			message: `Do you want to install dependencies with ${pm}?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(shouldInstall)) cancel();
		if (!shouldInstall) return SKIP;

		await Effect.runPromise(installDeps(pm, dir));
	},
});

export default installDepsStep;
