export { firstPartyRegistry as builtins } from "./registry/first-party";
export {
	findRemovalBlockers,
	loadAddonDefinition,
	loadDefinitionRegistry,
	RegistryLoadError,
	resolveBuiltins,
} from "./registry/loader";
