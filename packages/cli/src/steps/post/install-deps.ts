import { confirm, isCancel, log, spinner } from "@clack/prompts";
import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { type PackageManager, packageManagerCommand } from "@ryuujs/core";
import { Effect, Exit, Schema } from "effect";
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

async function runInstall(
	pm: PackageManager,
	cmd: ReturnType<typeof packageManagerCommand>,
	dir: string,
) {
	const s = spinner();
	s.start("We're installing your dependencies...");

	const exit = await Effect.runPromiseExit(installDeps(pm, cmd, dir));

	if (Exit.isFailure(exit)) {
		s.stop("We couldn't install your dependencies.");
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
