function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = { ...target };

	for (const key of Object.keys(source)) {
		const sourceValue = source[key];
		const targetValue = target[key];

		if (isPlainObject(sourceValue) && isPlainObject(targetValue))
			result[key] = deepMerge(targetValue, sourceValue);
		else if (Array.isArray(sourceValue) && Array.isArray(targetValue))
			result[key] = [...new Set([...targetValue, ...sourceValue])];
		else result[key] = sourceValue;
	}

	return result;
}

export function mergeJson(
	existing: Record<string, unknown>,
	patch: Record<string, unknown>,
	strategy: "deep" | "replace",
): Record<string, unknown> {
	if (strategy === "replace") return { ...existing, ...patch };
	return deepMerge(existing, patch);
}

export function threeWayMergeJson(
	base: Record<string, unknown>,
	current: Record<string, unknown>,
	incoming: Record<string, unknown>,
): { merged: Record<string, unknown>; conflicts: ReadonlyArray<string> } {
	const merged: Record<string, unknown> = { ...current };
	const conflicts: string[] = [];

	const allKeys = new Set([
		...Object.keys(base),
		...Object.keys(current),
		...Object.keys(incoming),
	]);

	for (const key of allKeys) {
		const baseValue = base[key];
		const currentValue = current[key];
		const incomingValue = incoming[key];

		const baseJson = JSON.stringify(baseValue);
		const currentJson = JSON.stringify(currentValue);
		const incomingJson = JSON.stringify(incomingValue);

		if (baseJson === incomingJson) {
			merged[key] = currentValue;
			continue;
		}

		if (baseJson === currentJson) {
			merged[key] = incomingValue;
			continue;
		}

		if (currentJson === incomingJson) {
			merged[key] = currentValue;
			continue;
		}

		if (
			isPlainObject(baseValue) &&
			isPlainObject(currentValue) &&
			isPlainObject(incomingValue)
		) {
			const nested = threeWayMergeJson(baseValue, currentValue, incomingValue);

			merged[key] = nested.merged;
			for (const nestedKey of nested.conflicts)
				conflicts.push(`${key}.${nestedKey}`);

			continue;
		}

		if (
			Array.isArray(currentValue) &&
			Array.isArray(incomingValue) &&
			Array.isArray(baseValue)
		) {
			const baseSet = new Set(baseValue.map((v) => JSON.stringify(v)));

			const currentAdded = currentValue.filter(
				(v) => !baseSet.has(JSON.stringify(v)),
			);

			const incomingAdded = incomingValue.filter(
				(v) => !baseSet.has(JSON.stringify(v)),
			);

			const kept = incomingValue.filter((v) => baseSet.has(JSON.stringify(v)));

			merged[key] = [
				...new Set([
					...kept.map((v) => JSON.stringify(v)),
					...currentAdded.map((v) => JSON.stringify(v)),
					...incomingAdded.map((v) => JSON.stringify(v)),
				]),
			].map((v) => JSON.parse(v));

			continue;
		}

		conflicts.push(key);
		merged[key] = incomingValue;
	}

	return { merged, conflicts };
}
