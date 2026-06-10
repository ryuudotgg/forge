import { type PackageManagerId, packageManagerCommand } from "@ryuujs/core";
import type { ForgeConfig } from "./config";

export function resolvePackageManager(config: ForgeConfig): PackageManagerId {
	return packageManagerCommand(config.packageManager ?? "pnpm");
}

export function pmRun(
	pm: PackageManagerId,
	script: string,
	args?: string,
): string {
	switch (pm) {
		case "pnpm":
			return args ? `pnpm ${script} ${args}` : `pnpm ${script}`;

		case "npm":
			return args ? `npm run ${script} -- ${args}` : `npm run ${script}`;

		case "yarn":
			return args ? `yarn ${script} ${args}` : `yarn ${script}`;

		case "bun":
			return args ? `bun run ${script} ${args}` : `bun run ${script}`;
	}
}

export interface WorkspacePackageRef {
	readonly name: string;
	readonly path: string;
}

export function pmRunIn(
	pm: PackageManagerId,
	pkg: WorkspacePackageRef,
	script: string,
): string {
	switch (pm) {
		case "pnpm":
			return `pnpm --filter ${pkg.name} run ${script}`;

		case "npm":
			return `npm run ${script} --prefix ${pkg.path}`;

		case "yarn":
			return `yarn workspace ${pkg.name} ${script}`;

		case "bun":
			return `bun --filter ${pkg.name} ${script}`;
	}
}

export function pmDlx(pm: PackageManagerId, command: string): string {
	switch (pm) {
		case "pnpm":
			return `pnpm dlx ${command}`;

		case "npm":
			return `npx ${command}`;

		case "yarn":
			return `yarn dlx ${command}`;

		case "bun":
			return `bunx ${command}`;
	}
}

export function pmExec(pm: PackageManagerId, command: string): string {
	switch (pm) {
		case "pnpm":
			return `pnpm exec ${command}`;

		case "npm":
			return `npx ${command}`;

		case "yarn":
			return `yarn exec ${command}`;

		case "bun":
			return `bunx ${command}`;
	}
}
