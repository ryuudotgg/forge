import { Schema } from "effect";

export const FilePath = Schema.String.pipe(Schema.brand("FilePath"));
export type FilePath = typeof FilePath.Type;

export const filePath = Schema.decodeSync(FilePath);

export interface Dependency {
	readonly name: string;
	readonly version: string;
	readonly type: "dependencies" | "devDependencies" | "peerDependencies";
	readonly catalog?: string;
}

export interface DependencyFormat {
	readonly useCatalog: boolean;
	readonly useWorkspaceProtocol: boolean;
}

export const defaultDependencyFormat: DependencyFormat = {
	useCatalog: true,
	useWorkspaceProtocol: true,
};

export function dependencyValue(
	dependency: Dependency,
	format: DependencyFormat,
): string {
	if (format.useCatalog && dependency.catalog !== undefined)
		return dependency.catalog === ""
			? "catalog:"
			: `catalog:${dependency.catalog}`;

	if (
		!format.useWorkspaceProtocol &&
		dependency.version.startsWith("workspace:")
	)
		return "*";

	return dependency.version;
}
