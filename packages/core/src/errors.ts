import { Schema } from "effect";

const optionalCause = Schema.optional(Schema.Defect);

const GeneratorErrorReason = Schema.Literal(
	"definition-failed",
	"framework-template-required",
	"framework-not-supported",
	"framework-not-supported-yet",
	"selected-template-not-supported",
	"required-slots-missing",
	"command-version-probe-failed",
	"command-version-missing",
);

const GeneratorErrorFields = Schema.Struct({
	generatorId: Schema.String,
	reason: GeneratorErrorReason,
	generatorName: Schema.optional(Schema.String),
	frameworkName: Schema.optional(Schema.String),
	missingSlots: Schema.optional(Schema.Array(Schema.String)),
	command: Schema.optional(Schema.String),
	detail: Schema.optional(Schema.String),
	cause: optionalCause,
});

type GeneratorErrorPayload = typeof GeneratorErrorFields.Type;

const generatorRequiredFields = {
	"definition-failed": ["detail"],
	"framework-template-required": ["generatorName"],
	"framework-not-supported": ["generatorName", "frameworkName"],
	"framework-not-supported-yet": ["generatorName", "frameworkName"],
	"selected-template-not-supported": ["generatorName", "frameworkName"],
	"required-slots-missing": ["generatorName", "frameworkName", "missingSlots"],
	"command-version-probe-failed": ["command", "detail"],
	"command-version-missing": ["command"],
} satisfies Record<
	typeof GeneratorErrorReason.Type,
	ReadonlyArray<keyof GeneratorErrorPayload>
>;

const ValidGeneratorErrorFields = GeneratorErrorFields.pipe(
	Schema.filter((payload) =>
		generatorRequiredFields[payload.reason].every(
			(key) => payload[key] !== undefined,
		),
	),
);

export class GeneratorError extends Schema.TaggedError<GeneratorError>()(
	"GeneratorError",
	ValidGeneratorErrorFields,
) {
	override get message() {
		return generatorMessages[this.reason](this);
	}
}

const generatorMessages = {
	"definition-failed": (error: GeneratorError) =>
		`Definition Failed: ${error.detail ?? ""}`,
	"framework-template-required": (error: GeneratorError) =>
		`${error.generatorName ?? ""} requires a web framework template.`,
	"framework-not-supported": (error: GeneratorError) =>
		`${error.generatorName ?? ""} does not support ${error.frameworkName ?? ""}.`,
	"framework-not-supported-yet": (error: GeneratorError) =>
		`${error.generatorName ?? ""} does not support ${error.frameworkName ?? ""} yet.`,
	"selected-template-not-supported": (error: GeneratorError) =>
		`${error.generatorName ?? ""} does not support the selected ${error.frameworkName ?? ""} template.`,
	"required-slots-missing": (error: GeneratorError) => {
		const slots = error.missingSlots ?? [];
		const formattedSlots = new Intl.ListFormat("en", {
			style: "long",
			type: "conjunction",
		}).format(slots.map((slot) => `${slot} slot`));

		return `${error.generatorName ?? ""} requires the ${formattedSlots}, but ${error.frameworkName ?? ""} does not provide ${slots.length === 1 ? "it" : "them"}.`;
	},
	"command-version-probe-failed": (error: GeneratorError) =>
		`Command Version Probe Failed: ${error.command ?? ""} ${error.detail ?? ""}`,
	"command-version-missing": (error: GeneratorError) =>
		`Command Version Missing: ${error.command ?? ""}`,
} satisfies Record<
	typeof GeneratorErrorReason.Type,
	(error: GeneratorError) => string
>;

const RegistryErrorReason = Schema.Literal(
	"duplicate",
	"framework-slots-invalid",
	"adapter-duplicate",
	"adapter-addon-missing",
	"adapter-framework-missing",
	"adapter-slot-missing",
);

const RegistryErrorFields = Schema.Struct({
	reason: RegistryErrorReason,
	registryId: Schema.String,
	subject: Schema.String,
	kind: Schema.optional(Schema.Literal("Addon", "Framework", "Template")),
	cause: optionalCause,
});

type RegistryErrorPayload = typeof RegistryErrorFields.Type;

const registryRequiredFields = {
	duplicate: ["kind"],
	"framework-slots-invalid": [],
	"adapter-duplicate": [],
	"adapter-addon-missing": [],
	"adapter-framework-missing": [],
	"adapter-slot-missing": [],
} satisfies Record<
	typeof RegistryErrorReason.Type,
	ReadonlyArray<keyof RegistryErrorPayload>
>;

const ValidRegistryErrorFields = RegistryErrorFields.pipe(
	Schema.filter((payload) =>
		registryRequiredFields[payload.reason].every(
			(key) => payload[key] !== undefined,
		),
	),
);

export class RegistryError extends Schema.TaggedError<RegistryError>()(
	"RegistryError",
	ValidRegistryErrorFields,
) {
	override get message() {
		return registryMessages[this.reason](this);
	}
}

const registryMessages = {
	duplicate: (error: RegistryError) =>
		`${error.kind ?? ""} Duplicate: ${error.subject}`,
	"framework-slots-invalid": (error: RegistryError) =>
		`Framework Slots Invalid: ${error.subject}`,
	"adapter-duplicate": (error: RegistryError) =>
		`Adapter Duplicate: ${error.subject}`,
	"adapter-addon-missing": (error: RegistryError) =>
		`Adapter Addon Missing: ${error.subject}`,
	"adapter-framework-missing": (error: RegistryError) =>
		`Adapter Framework Missing: ${error.subject}`,
	"adapter-slot-missing": (error: RegistryError) =>
		`Adapter Slot Missing: ${error.subject}`,
} satisfies Record<
	typeof RegistryErrorReason.Type,
	(error: RegistryError) => string
>;

export class CommandProbeError extends Schema.TaggedError<CommandProbeError>()(
	"CommandProbeError",
	{
		command: Schema.String,
		reason: Schema.Literal("probe-failed"),
		detail: Schema.String,
		cause: optionalCause,
	},
) {
	override get message() {
		return "Command Probe Failed";
	}
}

const ModuleConfigErrorReason = Schema.Literal(
	"not-found",
	"read-failed",
	"parse-failed",
	"invalid",
	"directory-failed",
	"write-failed",
);

const ModuleConfigErrorFields = Schema.Struct({
	filePath: Schema.String,
	reason: ModuleConfigErrorReason,
	detail: Schema.optional(Schema.String),
	issues: Schema.optional(Schema.Array(Schema.String)),
	cause: optionalCause,
});

type ModuleConfigErrorPayload = typeof ModuleConfigErrorFields.Type;

const moduleConfigRequiredFields = {
	"not-found": [],
	"read-failed": [],
	"parse-failed": ["detail"],
	invalid: ["issues"],
	"directory-failed": [],
	"write-failed": [],
} satisfies Record<
	typeof ModuleConfigErrorReason.Type,
	ReadonlyArray<keyof ModuleConfigErrorPayload>
>;

const ValidModuleConfigErrorFields = ModuleConfigErrorFields.pipe(
	Schema.filter((payload) =>
		moduleConfigRequiredFields[payload.reason].every(
			(key) => payload[key] !== undefined,
		),
	),
);

export class ModuleConfigError extends Schema.TaggedError<ModuleConfigError>()(
	"ModuleConfigError",
	ValidModuleConfigErrorFields,
) {
	override get message() {
		return moduleConfigMessages[this.reason](this);
	}
}

const moduleConfigMessages = {
	"not-found": () => "Module Config Not Found",
	"read-failed": () => "Module Config Read Failed",
	"parse-failed": (error: ModuleConfigError) =>
		`Module Config Parse Failed: ${error.detail ?? ""}`,
	invalid: (error: ModuleConfigError) =>
		`Invalid Module Config\n${(error.issues ?? [])
			.map((issue) => `  ${issue}`)
			.join("\n")}`,
	"directory-failed": () => "Module Config Directory Failed",
	"write-failed": () => "Module Config Write Failed",
} satisfies Record<
	typeof ModuleConfigErrorReason.Type,
	(error: ModuleConfigError) => string
>;

export class DuplicateModuleIdError extends Schema.TaggedError<DuplicateModuleIdError>()(
	"DuplicateModuleIdError",
	{
		moduleId: Schema.String,
		firstPath: Schema.String,
		secondPath: Schema.String,
		cause: optionalCause,
	},
) {
	override get message() {
		return "Duplicate Module Id";
	}
}

export class ModuleIdGenerationError extends Schema.TaggedError<ModuleIdGenerationError>()(
	"ModuleIdGenerationError",
	{ cause: optionalCause },
) {
	override get message() {
		return "Module Id Generation Failed";
	}
}

const StateErrorReason = Schema.Literal(
	"manifest-parse-failed",
	"manifest-invalid",
	"lockfile-parse-failed",
	"lockfile-invalid",
	"state-bundle-parse-failed",
	"state-bundle-invalid",
	"base-hash-failed",
	"state-bundle-read-failed",
	"manifest-missing",
	"manifest-read-failed",
	"manifest-directory-failed",
	"manifest-write-failed",
	"lockfile-read-failed",
	"lockfile-directory-failed",
	"lockfile-write-failed",
	"base-hash-invalid",
	"base-read-failed",
	"base-hash-mismatch",
	"base-directory-failed",
	"base-write-failed",
	"base-directory-read-failed",
	"base-remove-failed",
);

const StateErrorFields = Schema.Struct({
	filePath: Schema.String,
	reason: StateErrorReason,
	detail: Schema.optional(Schema.String),
	issues: Schema.optional(Schema.Array(Schema.String)),
	cause: optionalCause,
});

type StateErrorPayload = typeof StateErrorFields.Type;

const stateRequiredFields = {
	"manifest-parse-failed": ["detail"],
	"manifest-invalid": ["issues"],
	"lockfile-parse-failed": ["detail"],
	"lockfile-invalid": ["issues"],
	"state-bundle-parse-failed": ["detail"],
	"state-bundle-invalid": ["issues"],
	"base-hash-failed": [],
	"state-bundle-read-failed": [],
	"manifest-missing": [],
	"manifest-read-failed": [],
	"manifest-directory-failed": [],
	"manifest-write-failed": [],
	"lockfile-read-failed": [],
	"lockfile-directory-failed": [],
	"lockfile-write-failed": [],
	"base-hash-invalid": [],
	"base-read-failed": [],
	"base-hash-mismatch": [],
	"base-directory-failed": [],
	"base-write-failed": [],
	"base-directory-read-failed": [],
	"base-remove-failed": [],
} satisfies Record<
	typeof StateErrorReason.Type,
	ReadonlyArray<keyof StateErrorPayload>
>;

const ValidStateErrorFields = StateErrorFields.pipe(
	Schema.filter((payload) =>
		stateRequiredFields[payload.reason].every(
			(key) => payload[key] !== undefined,
		),
	),
);

export class StateError extends Schema.TaggedError<StateError>()(
	"StateError",
	ValidStateErrorFields,
) {
	override get message() {
		return stateMessages[this.reason](this);
	}
}

const stateMessages = {
	"manifest-parse-failed": (error: StateError) =>
		`Manifest Parse Failed: ${error.detail ?? ""}`,
	"manifest-invalid": (error: StateError) =>
		`Invalid Manifest\n${(error.issues ?? [])
			.map((issue) => `  ${issue}`)
			.join("\n")}`,
	"lockfile-parse-failed": (error: StateError) =>
		`Lockfile Parse Failed: ${error.detail ?? ""}`,
	"lockfile-invalid": (error: StateError) =>
		`Invalid Lockfile\n${(error.issues ?? [])
			.map((issue) => `  ${issue}`)
			.join("\n")}`,
	"state-bundle-parse-failed": (error: StateError) =>
		`State Bundle Parse Failed: ${error.detail ?? ""}`,
	"state-bundle-invalid": (error: StateError) =>
		`Invalid State Bundle\n${(error.issues ?? [])
			.map((issue) => `  ${issue}`)
			.join("\n")}`,
	"base-hash-failed": () => "Base Hash Failed",
	"state-bundle-read-failed": () => "State Bundle Read Failed",
	"manifest-missing": () => "Manifest Not Found",
	"manifest-read-failed": () => "Manifest Read Failed",
	"manifest-directory-failed": () => "Manifest Directory Failed",
	"manifest-write-failed": () => "Manifest Write Failed",
	"lockfile-read-failed": () => "Lockfile Read Failed",
	"lockfile-directory-failed": () => "Lockfile Directory Failed",
	"lockfile-write-failed": () => "Lockfile Write Failed",
	"base-hash-invalid": () => "Invalid Base Hash",
	"base-read-failed": () => "Base Read Failed",
	"base-hash-mismatch": () => "Base Hash Mismatch",
	"base-directory-failed": () => "Base Directory Failed",
	"base-write-failed": () => "Base Write Failed",
	"base-directory-read-failed": () => "Base Directory Read Failed",
	"base-remove-failed": () => "Base Remove Failed",
} satisfies Record<typeof StateErrorReason.Type, (error: StateError) => string>;

export class DiscoveryError extends Schema.TaggedError<DiscoveryError>()(
	"DiscoveryError",
	{
		path: Schema.String,
		reason: Schema.Literal("module-discovery-failed"),
		cause: Schema.Defect,
	},
) {
	override get message() {
		return `Module Discovery Failed: ${String(this.cause)}`;
	}
}

const PlannerErrorReason = Schema.Literal(
	"ensured-module-type-conflict",
	"ensured-app-module-conflict",
	"ensured-package-module-conflict",
	"ensured-module-conflict",
	"multiple-templates-selected",
	"definition-dependency-missing",
	"definition-dependency-inactive",
	"definition-cycle-detected",
	"adapter-target-must-be-module",
	"adapter-target-app-missing",
	"adapter-framework-missing",
	"module-key-conflict",
	"module-root-conflict",
	"selected-target-missing",
	"ensured-module-missing",
	"target-module-missing",
	"slot-path-requires-module-target",
	"slot-path-module-missing",
	"slot-path-target-mismatch",
	"slot-path-invalid",
	"leaf-file-conflict",
	"content-hash-failed",
	"write-path-collision",
	"definition-missing",
	"multiple-targets-selected",
);

const PlannerErrorFields = Schema.Struct({
	path: Schema.String,
	reason: PlannerErrorReason,
	detail: Schema.optional(Schema.String),
	cause: optionalCause,
});

type PlannerErrorPayload = typeof PlannerErrorFields.Type;

const plannerRequiredFields = {
	"ensured-module-type-conflict": [],
	"ensured-app-module-conflict": [],
	"ensured-package-module-conflict": [],
	"ensured-module-conflict": [],
	"multiple-templates-selected": [],
	"definition-dependency-missing": [],
	"definition-dependency-inactive": [],
	"definition-cycle-detected": [],
	"adapter-target-must-be-module": [],
	"adapter-target-app-missing": [],
	"adapter-framework-missing": [],
	"module-key-conflict": ["detail"],
	"module-root-conflict": [],
	"selected-target-missing": [],
	"ensured-module-missing": [],
	"target-module-missing": [],
	"slot-path-requires-module-target": [],
	"slot-path-module-missing": [],
	"slot-path-target-mismatch": [],
	"slot-path-invalid": ["detail"],
	"leaf-file-conflict": [],
	"content-hash-failed": [],
	"write-path-collision": ["detail"],
	"definition-missing": [],
	"multiple-targets-selected": [],
} satisfies Record<
	typeof PlannerErrorReason.Type,
	ReadonlyArray<keyof PlannerErrorPayload>
>;

const ValidPlannerErrorFields = PlannerErrorFields.pipe(
	Schema.filter((payload) =>
		plannerRequiredFields[payload.reason].every(
			(key) => payload[key] !== undefined,
		),
	),
);

export class PlannerError extends Schema.TaggedError<PlannerError>()(
	"PlannerError",
	ValidPlannerErrorFields,
) {
	override get message() {
		return plannerMessages[this.reason](this);
	}
}

const plannerMessages = {
	"ensured-module-type-conflict": () => "Ensured Module Type Conflict",
	"ensured-app-module-conflict": () => "Ensured App Module Conflict",
	"ensured-package-module-conflict": () => "Ensured Package Module Conflict",
	"ensured-module-conflict": () => "Ensured Module Conflict",
	"multiple-templates-selected": () => "Multiple Templates Selected",
	"definition-dependency-missing": () => "Definition Dependency Missing",
	"definition-dependency-inactive": () => "Definition Dependency Inactive",
	"definition-cycle-detected": () => "Definition Cycle Detected",
	"adapter-target-must-be-module": () => "Adapter Target Must Be Module",
	"adapter-target-app-missing": () => "Adapter Target App Missing",
	"adapter-framework-missing": () => "Adapter Framework Missing",
	"module-key-conflict": (error: PlannerError) => error.detail ?? "",
	"module-root-conflict": () => "Module Root Conflict",
	"selected-target-missing": () => "Selected Target Missing",
	"ensured-module-missing": () => "Ensured Module Missing",
	"target-module-missing": () => "Target Module Missing",
	"slot-path-requires-module-target": () => "Slot Path Requires Module Target",
	"slot-path-module-missing": () => "Slot Path Module Missing",
	"slot-path-target-mismatch": () => "Slot Path Target Mismatch",
	"slot-path-invalid": (error: PlannerError) => error.detail ?? "",
	"leaf-file-conflict": () => "Leaf File Conflict",
	"content-hash-failed": () => "Content Hash Failed",
	"write-path-collision": (error: PlannerError) => error.detail ?? "",
	"definition-missing": () => "Definition Missing",
	"multiple-targets-selected": () => "Multiple Targets Selected",
} satisfies Record<
	typeof PlannerErrorReason.Type,
	(error: PlannerError) => string
>;

export class RendererError extends Schema.TaggedError<RendererError>()(
	"RendererError",
	{
		path: Schema.String,
		reason: Schema.Literal("render-failed"),
		cause: Schema.Defect,
	},
) {
	override get message() {
		return `Render Failed: ${String(this.cause)}`;
	}
}

export const ApplyRefusalReason = Schema.Literal(
	"managed-file-modified",
	"unmanaged-file-exists",
);
export type ApplyRefusalReason = typeof ApplyRefusalReason.Type;

const ApplyErrorReason = Schema.Literal(
	"path-escapes-project-root",
	"content-hash-failed",
	"file-read-failed",
	"json-parse-failed",
	"managed-file-modified",
	"managed-base-read-failed",
	"resolution-label-unknown",
	"unmanaged-file-exists",
	"preflight-failed",
	"managed-base-forbidden",
	"managed-base-content-missing",
	"managed-base-hash-mismatch",
	"staging-directory-failed",
	"staged-directory-write-failed",
	"staged-file-write-failed",
	"atomic-state-backup-failed",
	"file-remove-failed",
	"directory-write-failed",
	"atomic-file-write-failed",
	"base-directory-failed",
	"atomic-base-write-failed",
	"atomic-manifest-write-failed",
	"atomic-lockfile-write-failed",
	"atomic-state-publish-failed",
);

const ApplyPreflightSchema = Schema.Struct({
	conflicts: Schema.optional(
		Schema.Array(
			Schema.Struct({
				base: Schema.Unknown,
				forge: Schema.Unknown,
				label: Schema.String,
				user: Schema.Unknown,
			}),
		),
	),
	hasConflicts: Schema.Boolean,
	hasManagedRemovals: Schema.Boolean,
	hasManagedRefusals: Schema.Boolean,
	hasUnmanagedRefusals: Schema.Boolean,
	hasUnmanagedRemovals: Schema.Boolean,
	refusals: Schema.optional(
		Schema.Array(
			Schema.Struct({
				resolvable: Schema.Boolean,
				reason: ApplyRefusalReason,
				operation: Schema.Literal("removal", "write"),
				path: Schema.String,
			}),
		),
	),
});

const ApplyErrorFields = Schema.Struct({
	path: Schema.String,
	reason: ApplyErrorReason,
	detail: Schema.optional(Schema.String),
	cause: optionalCause,
	preflight: Schema.optional(ApplyPreflightSchema),
});

type ApplyErrorPayload = typeof ApplyErrorFields.Type;

const applyRequiredFields = {
	"path-escapes-project-root": [],
	"content-hash-failed": [],
	"file-read-failed": [],
	"json-parse-failed": [],
	"managed-file-modified": [],
	"managed-base-read-failed": [],
	"resolution-label-unknown": ["detail"],
	"unmanaged-file-exists": [],
	"preflight-failed": ["detail"],
	"managed-base-forbidden": [],
	"managed-base-content-missing": [],
	"managed-base-hash-mismatch": [],
	"staging-directory-failed": [],
	"staged-directory-write-failed": [],
	"staged-file-write-failed": [],
	"atomic-state-backup-failed": [],
	"file-remove-failed": [],
	"directory-write-failed": [],
	"atomic-file-write-failed": [],
	"base-directory-failed": [],
	"atomic-base-write-failed": [],
	"atomic-manifest-write-failed": [],
	"atomic-lockfile-write-failed": [],
	"atomic-state-publish-failed": [],
} satisfies Record<
	typeof ApplyErrorReason.Type,
	ReadonlyArray<keyof ApplyErrorPayload>
>;

const ValidApplyErrorFields = ApplyErrorFields.pipe(
	Schema.filter((payload) =>
		applyRequiredFields[payload.reason].every(
			(key) => payload[key] !== undefined,
		),
	),
);

export class ApplyError extends Schema.TaggedError<ApplyError>()(
	"ApplyError",
	ValidApplyErrorFields,
) {
	override get message() {
		return applyMessages[this.reason](this);
	}
}

const applyMessages = {
	"path-escapes-project-root": () => "Path Escapes Project Root",
	"content-hash-failed": () => "Content Hash Failed",
	"file-read-failed": () => "File Read Failed",
	"json-parse-failed": () => "Managed JSON Parse Failed",
	"managed-file-modified": () => "Managed File Modified",
	"managed-base-read-failed": () => "Managed Base Read Failed",
	"resolution-label-unknown": (error: ApplyError) => error.detail ?? "",
	"unmanaged-file-exists": () => "Unmanaged File Exists",
	"preflight-failed": (error: ApplyError) => error.detail ?? "",
	"managed-base-forbidden": () => "Managed Base Forbidden",
	"managed-base-content-missing": () => "Managed Base Content Missing",
	"managed-base-hash-mismatch": () => "Managed Base Hash Mismatch",
	"staging-directory-failed": () => "Staging Directory Failed",
	"staged-directory-write-failed": () => "Staged Directory Write Failed",
	"staged-file-write-failed": () => "Staged File Write Failed",
	"atomic-state-backup-failed": () => "Atomic State Backup Failed",
	"file-remove-failed": () => "File Remove Failed",
	"directory-write-failed": () => "Directory Write Failed",
	"atomic-file-write-failed": () => "Atomic File Write Failed",
	"base-directory-failed": () => "Base Directory Failed",
	"atomic-base-write-failed": () => "Atomic Base Write Failed",
	"atomic-manifest-write-failed": () => "Atomic Manifest Write Failed",
	"atomic-lockfile-write-failed": () => "Atomic Lockfile Write Failed",
	"atomic-state-publish-failed": () => "Atomic State Publish Failed",
} satisfies Record<typeof ApplyErrorReason.Type, (error: ApplyError) => string>;

export const PlannerErrors = Schema.Union(
	PlannerError,
	GeneratorError,
	DiscoveryError,
	DuplicateModuleIdError,
	ModuleConfigError,
	ModuleIdGenerationError,
	RendererError,
	StateError,
);
export type PlannerErrors = typeof PlannerErrors.Type;

export const ApplyErrors = Schema.Union(ApplyError, StateError);
export type ApplyErrors = typeof ApplyErrors.Type;

export const StateErrors = Schema.Union(StateError);
export type StateErrors = typeof StateErrors.Type;

export const RegistryErrors = Schema.Union(RegistryError, GeneratorError);
export type RegistryErrors = typeof RegistryErrors.Type;
