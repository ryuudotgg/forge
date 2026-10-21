import { GeneratorError } from "@ryuugg/core";

export function refusalMessage(failure: unknown): string | undefined {
	return failure instanceof GeneratorError && failure.reason === "refused"
		? failure.message
		: undefined;
}
