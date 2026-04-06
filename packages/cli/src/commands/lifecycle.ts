import { log } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import { CoreLive, State } from "@ryuujs/core";
import { Effect, Layer } from "effect";

function lifecycleUnavailableMessage(command: string) {
	return `We haven't implemented "${command}" yet for the current Forge architecture.`;
}

function unmanagedProjectMessage(command: string) {
	return `This project hasn't been bootstrapped with the current Forge metadata yet, so we can't run "${command}" here.`;
}

export async function failLifecycleCommand(
	projectRoot: string,
	command: string,
) {
	const coreLayer = CoreLive.pipe(Layer.provideMerge(NodeContext.layer));
	const isManagedProject = await Effect.runPromise(
		State.isManagedProject(projectRoot).pipe(Effect.provide(coreLayer)),
	);

	log.error(
		isManagedProject
			? lifecycleUnavailableMessage(command)
			: unmanagedProjectMessage(command),
	);

	process.exit(1);
}
