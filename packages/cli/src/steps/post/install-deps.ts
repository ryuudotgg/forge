import { confirm, isCancel, spinner } from "@clack/prompts";
import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { type PackageManager, packageManagerCommand } from "@ryuujs/core";
import { Effect, Schema } from "effect";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
	pm: Schema.String,
	exitCode: Schema.Number,
	message: Schema.String,
}) {}

function installDeps(
	pm: PackageManager,
	cmd: ReturnType<typeof packageManagerCommand>,
	dir: string,
) {
	return Effect.gen(function* () {
		const code = yield* Command.exitCode(
			Command.make(cmd, "install").pipe(
				Command.workingDirectory(dir),
				Command.stdout("pipe"),
				Command.stderr("pipe"),
			),
		);

		if (code !== 0)
			return yield* new InstallError({
				pm,
				exitCode: code,
				message: `Install Failed: ${pm} Exited With Code ${code}`,
			});
	}).pipe(Effect.provide(NodeContext.layer));
}

const installDepsStep = defineStep({
	id: "installDeps",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		const pm = config.packageManager ?? "pnpm";
		const cmd = packageManagerCommand(pm);
		const dir = String(config.path);

		if (!interactive) {
			const s = spinner();

			s.start("We're installing your dependencies...");
			await Effect.runPromise(installDeps(pm, cmd, dir));
			s.stop("We've installed your dependencies!");

			return SKIP;
		}

		const shouldInstall = await confirm({
			message: `Do you want to install dependencies with ${pm}?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(shouldInstall)) cancel();
		if (!shouldInstall) return SKIP;

		const s = spinner();

		s.start("We're installing your dependencies...");
		await Effect.runPromise(installDeps(pm, cmd, dir));
		s.stop("We've installed your dependencies!");
	},
});

export default installDepsStep;
