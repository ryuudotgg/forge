import { log } from "@clack/prompts";
import { NodeContext } from "@effect/platform-node";
import { CoreLive } from "@ryuujs/core";
import {
	Cause,
	type Effect,
	Exit,
	Layer,
	ManagedRuntime,
	Option,
} from "effect";
import { AdoptionDetector } from "./commands/adoption";

export const cliLayer = Layer.mergeAll(CoreLive, AdoptionDetector.Default).pipe(
	Layer.provideMerge(NodeContext.layer),
);

export type CliServices = Layer.Layer.Success<typeof cliLayer>;
type CliRuntime = ManagedRuntime.ManagedRuntime<CliServices, never>;

let activeRuntime: CliRuntime | undefined;
let processRuntime: CliRuntime | undefined;

export function makeCliRuntime(): CliRuntime {
	return ManagedRuntime.make(cliLayer);
}

export async function withCliRuntime<A>(
	run: () => Promise<A>,
	runtime: CliRuntime = makeCliRuntime(),
): Promise<A> {
	if (activeRuntime !== undefined)
		throw new Error("CLI Runtime Already Active: nested command execution.");

	activeRuntime = runtime;
	try {
		return await run();
	} finally {
		activeRuntime = undefined;
		await runtime.dispose();
	}
}

export async function runCliEffect<A, E>(
	effect: Effect.Effect<A, E, CliServices>,
): Promise<Exit.Exit<A, E>> {
	if (activeRuntime !== undefined) return activeRuntime.runPromiseExit(effect);

	processRuntime ??= makeCliRuntime();
	return processRuntime.runPromiseExit(effect);
}

export async function runCliEffectValue<A, E>(
	effect: Effect.Effect<A, E, CliServices>,
): Promise<A> {
	const exit = await runCliEffect(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw failureFromCause(exit.cause);
}

export function failureFromCause<E>(cause: Cause.Cause<E>): E {
	const failure = Cause.failureOption(cause);
	if (Option.isSome(failure)) return failure.value;

	const defect = Cause.squash(cause);
	log.error(
		"We couldn't complete this command because an unexpected error occurred.",
	);

	console.error(defect);
	process.exit(1);
}
