import { confirm, isCancel, log, spinner } from "@clack/prompts";
import {
	LONG_RUNNING_TIMEOUT_MS,
	type PackageManager,
	packageManagerCommand,
	Subprocess,
} from "@ryuujs/core";
import { Cause, Exit, Option } from "effect";
import { runCliEffect } from "../../runtime";
import { cancel } from "../../utils/cancel";
import { defineStep, SKIP } from "../types";

function installDeps(
	cmd: ReturnType<typeof packageManagerCommand>,
	dir: string,
) {
	return Subprocess.run({
		command: cmd,
		args: ["install"],
		cwd: dir,
		timeoutMs: LONG_RUNNING_TIMEOUT_MS,
		outputMode: "pipe",
	});
}

async function runInstall(
	pm: PackageManager,
	cmd: ReturnType<typeof packageManagerCommand>,
	dir: string,
) {
	const s = spinner();
	s.start("We're installing your dependencies...");

	const exit = await runCliEffect(installDeps(cmd, dir));

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
