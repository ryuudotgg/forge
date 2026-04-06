import { execFileSync } from "node:child_process";
import { Effect, Schema } from "effect";
import { CommandProbeError } from "./errors";

export class CommandProbe extends Effect.Service<CommandProbe>()(
	"CommandProbe",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const readVersion = Effect.fn("CommandProbe.readVersion")(function* (
				command: string,
			) {
				return yield* Effect.try({
					try: () =>
						execFileSync(command, ["--version"], { encoding: "utf-8" })
							.trim()
							.replace(/^v/, ""),

					catch: (error) =>
						new CommandProbeError({
							command,
							message: `Command Probe Failed`,
							detail: error instanceof Error ? error.message : String(error),
						}),
				});
			});

			return { readVersion };
		}),
	},
) {}

export const CommandVersionSchema = Schema.String;
