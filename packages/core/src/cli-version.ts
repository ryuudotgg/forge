import { Context } from "effect";

export class CliVersion extends Context.Service<
	CliVersion,
	{ readonly version: string }
>()("CliVersion") {}
