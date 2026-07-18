import { Effect } from "effect";

export function hashContentHex<E>(
	content: string,
	onError: () => E,
): Effect.Effect<string, E> {
	const data = new TextEncoder().encode(content);

	return Effect.tryPromise({
		try: () => globalThis.crypto.subtle.digest("SHA-256", data),
		catch: onError,
	}).pipe(
		Effect.map((buffer) =>
			Array.from(new Uint8Array(buffer))
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join(""),
		),
	);
}
