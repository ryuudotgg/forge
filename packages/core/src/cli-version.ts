import { Context } from "effect";

export class CliVersion extends Context.Service<
	CliVersion,
	{ readonly version: string }
>()("CliVersion") {}

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

interface Semver {
	readonly core: readonly [bigint, bigint, bigint];
	readonly prerelease: ReadonlyArray<string>;
}

function parseSemver(version: string): Semver | undefined {
	const match = SEMVER_PATTERN.exec(version);
	if (match === null) return undefined;

	const [, major = "", minor = "", patch = "", prerelease] = match;
	return {
		core: [BigInt(major), BigInt(minor), BigInt(patch)],
		prerelease: prerelease === undefined ? [] : prerelease.split("."),
	};
}

function compareBigInt(left: bigint, right: bigint) {
	return left === right ? 0 : left < right ? -1 : 1;
}

function comparePrereleaseIdentifier(left: string, right: string) {
	const leftNumeric = /^\d+$/.test(left);
	const rightNumeric = /^\d+$/.test(right);
	if (leftNumeric && rightNumeric)
		return compareBigInt(BigInt(left), BigInt(right));

	if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;

	return left === right ? 0 : left < right ? -1 : 1;
}

function comparePrerelease(
	left: ReadonlyArray<string>,
	right: ReadonlyArray<string>,
) {
	if (left.length === 0 && right.length === 0) return 0;
	if (left.length === 0) return 1;
	if (right.length === 0) return -1;

	for (let index = 0; index < Math.min(left.length, right.length); index++) {
		const order = comparePrereleaseIdentifier(
			left[index] ?? "",
			right[index] ?? "",
		);

		if (order !== 0) return order;
	}

	return Math.sign(left.length - right.length);
}

export function compareCliVersions(
	left: string,
	right: string,
): number | undefined {
	const parsedLeft = parseSemver(left);
	const parsedRight = parseSemver(right);
	if (parsedLeft === undefined || parsedRight === undefined) return undefined;

	for (let index = 0; index < 3; index++) {
		const order = compareBigInt(
			parsedLeft.core[index] ?? 0n,
			parsedRight.core[index] ?? 0n,
		);

		if (order !== 0) return order;
	}

	return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}
