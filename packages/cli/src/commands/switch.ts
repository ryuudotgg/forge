import { log, spinner } from "@clack/prompts";
import {
	type AddonDefinition,
	type InstallRecord,
	LONG_RUNNING_TIMEOUT_MS,
	packageManagerExecCommand,
	packageManagerInstallCommand,
	Subprocess,
	trackedFiles,
	workingTreeStatus,
} from "@ryuugg/core";
import { configWithSwitch, type ForgeConfig } from "@ryuugg/generators";
import { Exit } from "effect";
import { failureFromCause, runCliEffect } from "../runtime";
import {
	applyInstalledPlan,
	configuredPackageManager,
	type ManagedProject,
} from "./lifecycle";
import type { ResolutionArguments } from "./resolution";

interface SwitchRequest {
	readonly addon: AddonDefinition<ForgeConfig>;
	readonly holder: AddonDefinition<ForgeConfig>;
	readonly installs: ReadonlyArray<InstallRecord>;
	readonly registryIds: ReadonlyArray<string> | undefined;
	readonly noInstall: boolean;
	readonly resolution: ResolutionArguments;
}

function shellCommand(operation: {
	readonly command: string;
	readonly args: ReadonlyArray<string>;
}) {
	return [operation.command, ...operation.args].join(" ");
}

async function operationFailure(
	projectRoot: string,
	operation: { readonly command: string; readonly args: ReadonlyArray<string> },
) {
	const exit = await runCliEffect(
		Subprocess.run({
			command: operation.command,
			args: operation.args,
			cwd: projectRoot,
			timeoutMs: LONG_RUNNING_TIMEOUT_MS,
			outputMode: "pipe",
		}),
	);

	return Exit.isSuccess(exit)
		? undefined
		: failureFromCause(exit.cause).message;
}

function pathChunks(paths: ReadonlyArray<string>) {
	const chunks: string[][] = [];

	let chunk: string[] = [];
	let bytes = 0;
	for (const path of paths) {
		const argument = `./${path}`;
		const size = Buffer.byteLength(argument) + 1;
		if (bytes + size > 96 * 1024 && chunk.length > 0) {
			chunks.push(chunk);
			chunk = [];
			bytes = 0;
		}

		chunk.push(argument);
		bytes += size;
	}

	if (chunk.length > 0) chunks.push(chunk);

	return chunks;
}

export async function runSwitch(
	project: ManagedProject,
	request: SwitchRequest,
) {
	const { addon, holder, installs, registryIds } = request;
	const switching = addon.switching;
	if (switching === undefined)
		throw new Error(`Addon Switching Missing: ${addon.id}`);

	const status = await runCliEffect(workingTreeStatus(project.projectRoot));
	if (Exit.isFailure(status)) {
		log.error(
			"We couldn't check this project's Git status. Nothing was changed.",
		);

		process.exit(1);
	}

	if (status.value._tag !== "Clean") {
		log.error(
			status.value._tag === "Dirty"
				? `We can't switch from ${holder.name} to ${addon.name} while you have uncommitted changes. Commit or stash them first.`
				: `We can't switch from ${holder.name} to ${addon.name} until Git tracks this project. Commit your project first.`,
		);

		process.exit(1);
	}

	log.info(
		`This project uses ${holder.name}, so we're switching it to ${addon.name}.`,
	);

	const config = configWithSwitch(project.config, holder.id, addon.id);
	const packageManager = configuredPackageManager(config);
	const install = packageManagerInstallCommand(packageManager);
	const reformat = (paths: ReadonlyArray<string>) =>
		packageManagerExecCommand(packageManager, switching.reformat.bin, [
			...switching.reformat.args,
			...paths,
		]);

	const remaining = `Run "${shellCommand(install)}", then "${shellCommand(reformat(["."]))}", then "forge update --keep-user" inside the project to finish the switch.`;

	const applied = await applyInstalledPlan(
		project.projectRoot,
		config,
		installs,
		undefined,
		registryIds,
		{ ...request.resolution[0], departing: [holder.id] },
	);

	for (const { path, lines } of applied.dropped) {
		const removed = `${holder.name} is gone, so we removed ${path} and the changes you made to it.`;
		const kept = lines.trim();
		log.warn(
			kept === ""
				? `${removed} They're still in your last commit.`
				: `${removed} They're still in your last commit:\n${kept}`,
		);
	}

	if (request.noInstall) {
		log.warn(
			`We switched the addon configuration from ${holder.name} to ${addon.name}, but haven't installed its dependencies or reformatted your files yet. ${remaining}`,
		);

		return;
	}

	const progress = spinner();
	progress.start("We're installing your dependencies...");
	const installFailure = await operationFailure(project.projectRoot, install);
	if (installFailure !== undefined) {
		progress.stop("We couldn't install your dependencies.");
		log.error(
			`The configuration was switched, but the install failed. ${remaining}`,
		);

		log.message(installFailure);
		process.exit(1);
	}

	progress.stop("We've installed your dependencies!");

	progress.start(
		`Reformatting this project's tracked files with ${addon.name}.`,
	);

	const files = await runCliEffect(trackedFiles(project.projectRoot));
	if (Exit.isFailure(files)) {
		progress.stop("We couldn't read this project's tracked files.");
		log.error(
			`The configuration was switched and dependencies installed, but reformatting couldn't start. ${remaining}`,
		);

		process.exit(1);
	}

	for (const chunk of pathChunks(files.value)) {
		const reformatFailure = await operationFailure(
			project.projectRoot,
			reformat(chunk),
		);

		if (reformatFailure !== undefined) {
			progress.stop("Reformatting didn't finish.");
			log.error(
				`The configuration was switched and dependencies installed, but reformatting failed. ${remaining}`,
			);

			log.message(reformatFailure);
			process.exit(1);
		}
	}

	progress.stop("Reformatted this project's tracked files.");

	await applyInstalledPlan(
		project.projectRoot,
		config,
		installs,
		undefined,
		registryIds,
		{ resolutionPolicy: "keep-user", departing: [holder.id] },
	);

	log.success(
		`We switched this project from ${holder.name} to ${addon.name}. Review the changes and commit them.`,
	);
}
