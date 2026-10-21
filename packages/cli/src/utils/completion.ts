import { type PackageManager, packageManagerCommand } from "@ryuugg/core";

export function shellArgument(value: string) {
	if (/^[\w@+=:,./-]+$/.test(value)) return value;
	if (!/["$`\\!%]/.test(value)) return `"${value}"`;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function completionLine(
	done: string,
	applied: { readonly dependenciesChanged: boolean },
	packageManager: PackageManager,
) {
	if (!applied.dependenciesChanged) return done;

	const install = packageManagerCommand(packageManager);
	return `${done} Run "${install} install" to update your dependencies.`;
}
