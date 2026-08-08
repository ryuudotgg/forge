import {
	CommandProbe,
	GeneratorError,
	packageManagerCommand,
	runtimeCommand,
	runtimes,
} from "@ryuujs/core";
import { Effect } from "effect";
import type { ForgeConfig } from "../config";

function probeRequiredVersion(command: string) {
	return CommandProbe.readVersion(command).pipe(
		Effect.mapError(
			(error) =>
				new GeneratorError({
					generatorId: "root",
					reason: "command-version-probe-failed",
					command,
					detail: error.detail,
					cause: error,
				}),
		),
	);
}

export function probeWorkspaceCommandVersions(
	config: ForgeConfig,
	persisted: Readonly<Record<string, string>> = {},
) {
	return Effect.gen(function* () {
		const runtime = config.runtime ?? "Node.js";
		const runtimeCommandName = runtimeCommand(runtime);

		const packageManager = config.packageManager ?? "pnpm";
		const packageManagerCommandName = packageManagerCommand(packageManager);

		const runtimeVersion =
			persisted[runtimeCommandName] ??
			(yield* probeRequiredVersion(runtimeCommandName));

		const nodeVersion =
			persisted.node ??
			(runtime === "Node.js"
				? runtimeVersion
				: yield* CommandProbe.readVersion("node").pipe(
						Effect.catchTag("CommandProbeError", () =>
							Effect.succeed(`${runtimes.node.minimumMajor}`),
						),
					));

		const packageManagerVersion =
			persisted[packageManagerCommandName] ??
			(yield* probeRequiredVersion(packageManagerCommandName));

		return {
			...persisted,
			node: nodeVersion,
			[packageManagerCommandName]: packageManagerVersion,
			[runtimeCommandName]: runtimeVersion,
		};
	});
}
