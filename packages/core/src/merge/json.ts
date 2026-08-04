import type { MergeConflictResolution } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return false;
		return left.every((value, index) => jsonEqual(value, right[index]));
	}

	if (!isPlainObject(left) || !isPlainObject(right)) return false;

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;

	return leftKeys.every(
		(key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]),
	);
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;

	if (isPlainObject(value))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;

	return JSON.stringify(value) ?? "undefined";
}

function arrayKey(value: unknown): string {
	return canonicalJson(value);
}

function threeWayMergeArrays(
	base: ReadonlyArray<unknown>,
	current: ReadonlyArray<unknown>,
	incoming: ReadonlyArray<unknown>,
	resolution?: MergeConflictResolution,
): { readonly conflicts: boolean; readonly merged: unknown[] } {
	if (base.length === current.length && base.length === incoming.length) {
		const indexed: unknown[] = [];

		let conflicts = false;
		for (let index = 0; index < base.length; index++) {
			const baseValue = base[index];
			const currentValue = current[index];
			const incomingValue = incoming[index];

			if (jsonEqual(currentValue, incomingValue)) indexed.push(currentValue);
			else if (jsonEqual(baseValue, currentValue)) indexed.push(incomingValue);
			else if (jsonEqual(baseValue, incomingValue)) indexed.push(currentValue);
			else {
				conflicts = true;
				indexed.push(resolution === "user" ? currentValue : incomingValue);
			}
		}

		if (conflicts && resolution !== undefined)
			return {
				conflicts,
				merged: [...(resolution === "user" ? current : incoming)],
			};

		return { conflicts, merged: indexed };
	}

	const baseKeys = new Set(base.map(arrayKey));
	const currentKeys = new Set(current.map(arrayKey));
	const incomingKeys = new Set(incoming.map(arrayKey));

	const merged: unknown[] = [];
	const mergedKeys = new Set<string>();

	const append = (value: unknown) => {
		const key = arrayKey(value);

		if (mergedKeys.has(key)) return;
		mergedKeys.add(key);

		merged.push(value);
	};

	for (const value of base) {
		const key = arrayKey(value);
		if (currentKeys.has(key) && incomingKeys.has(key)) append(value);
	}

	for (const value of current)
		if (!baseKeys.has(arrayKey(value))) append(value);

	for (const value of incoming)
		if (!baseKeys.has(arrayKey(value))) append(value);

	const currentAdds = current.filter((value) => !baseKeys.has(arrayKey(value)));
	const incomingAdds = incoming.filter(
		(value) => !baseKeys.has(arrayKey(value)),
	);

	const currentRemovals = base.filter(
		(value) => !currentKeys.has(arrayKey(value)),
	);

	const incomingRemovals = base.filter(
		(value) => !incomingKeys.has(arrayKey(value)),
	);

	if (currentRemovals.length === 0 && incomingRemovals.length === 0)
		return { conflicts: false, merged };

	if (currentAdds.length === 0 && incomingRemovals.length === 0)
		return {
			conflicts: false,
			merged: incoming.filter(
				(value) => !currentRemovals.some((entry) => jsonEqual(entry, value)),
			),
		};

	if (incomingAdds.length === 0 && currentRemovals.length === 0)
		return {
			conflicts: false,
			merged: current.filter(
				(value) => !incomingRemovals.some((entry) => jsonEqual(entry, value)),
			),
		};

	if (currentAdds.length === 0 && incomingAdds.length === 0)
		return { conflicts: false, merged };

	return {
		conflicts: true,
		merged: [...(resolution === "user" ? current : incoming)],
	};
}

function isDependencyPath(path: ReadonlyArray<string>): boolean {
	return (
		path.length === 2 &&
		[
			"dependencies",
			"devDependencies",
			"peerDependencies",
			"optionalDependencies",
		].includes(path[0] ?? "")
	);
}

function isDependencyMapPath(path: ReadonlyArray<string>): boolean {
	return path.length === 1 && isDependencyPath([...path, "package"]);
}

function isScriptMapPath(path: ReadonlyArray<string>): boolean {
	return path.length === 1 && path[0] === "scripts";
}

export interface MergeJsonOptions {
	readonly preserveDependencyRemovals?: boolean;
	readonly resolveConflict?: (
		path: ReadonlyArray<string>,
	) => MergeConflictResolution | undefined;
	readonly resolution?: MergeConflictResolution;
}

export interface JsonMergeResult {
	readonly merged: Record<string, unknown>;
	readonly conflicts: ReadonlyArray<ReadonlyArray<string>>;
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
			result[key] = mergeArrays(targetValue, sourceValue);
		else result[key] = sourceValue;
	}

	return result;
}

function mergeArrays(target: unknown[], source: unknown[]): unknown[] {
	const primitives = new Set<unknown>();
	const structures = new Set<string | undefined>();

	const merged: unknown[] = [];
	for (const value of [...target, ...source]) {
		if (typeof value === "object" && value !== null) {
			const serialized = JSON.stringify(value);
			if (structures.has(serialized)) continue;

			structures.add(serialized);
			merged.push(value);

			continue;
		}

		if (primitives.has(value)) continue;

		primitives.add(value);
		merged.push(value);
	}

	return merged;
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
	options: MergeJsonOptions = {},
): JsonMergeResult {
	return mergeJsonObjects(base, current, incoming, options, []);
}

export function jsonResidue(
	base: Record<string, unknown>,
	current: Record<string, unknown>,
): Record<string, unknown> {
	const residue: Record<string, unknown> = {};

	for (const [key, currentValue] of Object.entries(current)) {
		if (!Object.hasOwn(base, key)) {
			residue[key] = currentValue;
			continue;
		}

		const baseValue = base[key];

		if (jsonEqual(baseValue, currentValue)) continue;
		if (isPlainObject(baseValue) && isPlainObject(currentValue)) {
			const nested = jsonResidue(baseValue, currentValue);
			if (Object.keys(nested).length > 0) residue[key] = nested;
			continue;
		}

		if (Array.isArray(baseValue) && Array.isArray(currentValue)) {
			const baseKeys = new Set(baseValue.map(arrayKey));
			const additions = currentValue.filter(
				(value) => !baseKeys.has(arrayKey(value)),
			);

			if (additions.length > 0) residue[key] = additions;

			continue;
		}

		residue[key] = currentValue;
	}

	return residue;
}

function mergeJsonObjects(
	base: Record<string, unknown>,
	current: Record<string, unknown>,
	incoming: Record<string, unknown>,
	options: MergeJsonOptions,
	path: ReadonlyArray<string>,
): JsonMergeResult {
	const merged: Record<string, unknown> = {};
	const conflicts: Array<ReadonlyArray<string>> = [];

	const allKeys = new Set([
		...Object.keys(base),
		...Object.keys(current),
		...Object.keys(incoming),
	]);

	for (const key of allKeys) {
		const keyPath = [...path, key];

		const basePresent = Object.hasOwn(base, key);
		const currentPresent = Object.hasOwn(current, key);
		const incomingPresent = Object.hasOwn(incoming, key);

		const baseValue = base[key];
		const currentValue = current[key];
		const incomingValue = incoming[key];

		if (
			basePresent === incomingPresent &&
			jsonEqual(baseValue, incomingValue)
		) {
			if (currentPresent) merged[key] = currentValue;
			continue;
		}

		if (basePresent === currentPresent && jsonEqual(baseValue, currentValue)) {
			if (incomingPresent) merged[key] = incomingValue;
			continue;
		}

		if (
			currentPresent === incomingPresent &&
			jsonEqual(currentValue, incomingValue)
		) {
			if (currentPresent) merged[key] = currentValue;
			continue;
		}

		if (
			options.preserveDependencyRemovals === true &&
			basePresent &&
			!currentPresent &&
			isDependencyPath(keyPath)
		)
			continue;

		if (
			(isScriptMapPath(keyPath) ||
				(options.preserveDependencyRemovals === true &&
					isDependencyMapPath(keyPath))) &&
			(baseValue === undefined || isPlainObject(baseValue)) &&
			(currentValue === undefined || isPlainObject(currentValue)) &&
			(incomingValue === undefined || isPlainObject(incomingValue))
		) {
			const nested = mergeJsonObjects(
				baseValue ?? {},
				currentValue ?? {},
				incomingValue ?? {},
				options,
				keyPath,
			);

			if (Object.keys(nested.merged).length > 0 || currentPresent)
				merged[key] = nested.merged;

			conflicts.push(...nested.conflicts);
			continue;
		}

		if (
			isPlainObject(baseValue) &&
			isPlainObject(currentValue) &&
			isPlainObject(incomingValue)
		) {
			const nested = mergeJsonObjects(
				baseValue,
				currentValue,
				incomingValue,
				options,
				keyPath,
			);

			merged[key] = nested.merged;
			conflicts.push(...nested.conflicts);

			continue;
		}

		if (
			Array.isArray(currentValue) &&
			Array.isArray(incomingValue) &&
			Array.isArray(baseValue)
		) {
			const arrayResult = threeWayMergeArrays(
				baseValue,
				currentValue,
				incomingValue,
				options.resolveConflict?.(keyPath) ?? options.resolution,
			);

			merged[key] = arrayResult.merged;

			if (arrayResult.conflicts) conflicts.push(keyPath);

			continue;
		}

		conflicts.push(keyPath);

		const resolution = options.resolveConflict?.(keyPath) ?? options.resolution;
		if (resolution === "user") {
			if (currentPresent) merged[key] = currentValue;
		} else if (incomingPresent) merged[key] = incomingValue;
	}

	return { merged, conflicts };
}
