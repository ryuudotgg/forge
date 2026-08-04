export type MergeConflictResolution = "forge" | "user";
export type MergeConflictResolver = (
	label: string,
) => MergeConflictResolution | undefined;
