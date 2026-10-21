export {
	type AdoptionDetection,
	AdoptionDetector,
	type AdoptionToolingPrefills,
} from "./detector";
export type {
	AdoptedModuleVersions,
	CapturedDependencyPin,
	CommandPins,
	ConfirmedModule,
	DependencySection,
	ModuleKind,
	ModuleMappingProposal,
	PinnedPackageManager,
} from "./mapping";
export {
	type AdoptedSecondary,
	type AdoptedWebApp,
	type AdoptionContext,
	type AdoptionLayout,
	AdoptionRefusal,
	adoptedWebConfig,
	adoptionRefusal,
	primaryWebAppRefusal,
	primaryWebRoot,
	type RequestedWebApps,
	type ResolvedWebApps,
	resolveWebAppAdoption,
	rpcProviderRefusal,
	type ScriptPort,
	scriptPort,
	secondaryWebAppsSentence,
	type WebAppObservation,
	webRoots,
} from "./web-apps";
export {
	AdoptionFileParseError,
	AdoptionFileReadError,
	AdoptionTraversalLimitError,
	type CatalogEntry,
} from "./workspace";
