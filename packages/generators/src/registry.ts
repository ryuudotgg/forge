export { firstPartyRegistry as builtins } from "./registry/first-party";
export type {
	LoadDefinitionRegistryOptions,
	RegistryPackageImport,
	RegistryPackageImporter,
} from "./registry/loader";
export {
	findRemovalBlockers,
	importRegistryPackage,
	loadAddonDefinition,
	loadDefinitionRegistry,
	RegistryLoadError,
} from "./registry/loader";
export type {
	RegistryDescriptor,
	RegistryPackageManifest,
	RegistryUnit,
} from "./registry/types";
export {
	decodeRegistryPackageManifest,
	RegistryPackageManifestSchema,
} from "./registry/types";
