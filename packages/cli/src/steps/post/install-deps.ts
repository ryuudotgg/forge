import { confirm, isCancel, log, spinner } from "@clack/prompts";
import { Command } from "@effect/platform";
import { type PackageManager, packageManagerCommand } from "@ryuujs/core";
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { runCliEffect } from "../../runtime";
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
	});
}

async function runInstall(
	pm: PackageManager,
	cmd: ReturnType<typeof packageManagerCommand>,
	dir: string,
) {
	const s = spinner();
	s.start("We're installing your dependencies...");

	const exit = await runCliEffect(installDeps(pm, cmd, dir));

	if (Exit.isFailure(exit)) {
		s.stop("We couldn't install your dependencies.");
		if (Option.isNone(Cause.failureOption(exit.cause)))
			console.error(Cause.squash(exit.cause));

		log.warn(
			`The ${pm} install didn't finish, so run it yourself inside the project when you're ready.`,
		);

		return;
	}

	s.stop("We've installed your dependencies!");
}

const installDepsStep = defineStep({
	id: "installDeps",
	group: "outro",
	schema: null,
	configKey: null,

	shouldRun: () => true,

	async execute(config, interactive) {
		if (config.installDeps === false) return SKIP;

		const pm = config.packageManager ?? "pnpm";
		const cmd = packageManagerCommand(pm);
		const dir = String(config.path);

		if (!interactive) {
			await runInstall(pm, cmd, dir);
			return SKIP;
		}

		const shouldInstall = await confirm({
			message: `Do you want to install dependencies with ${pm}?`,
			active: "Yes",
			inactive: "No",
		});

		if (isCancel(shouldInstall)) cancel();
		if (!shouldInstall) return SKIP;

		await runInstall(pm, cmd, dir);
	},
});

export default installDepsStep;
