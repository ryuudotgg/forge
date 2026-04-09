import type {
	AddonDefinition,
	CapabilityId,
	FrameworkDefinition,
	GeneratorCategory,
	ManagedSurfaceName,
	TemplateDefinition,
} from "@ryuujs/core";
import type { ForgeConfig } from "./config";
import { builtins } from "./registry";

export type CatalogKind = "addon" | "framework" | "template";

interface CatalogEntryBase {
	readonly id: string;
	readonly name: string;
	readonly summary: string;
	readonly description: string;
	readonly category: GeneratorCategory;
	readonly keywords: ReadonlyArray<string>;
	readonly hidden: boolean;
	readonly experimental: boolean;
	readonly docsUrl?: string;
}

export interface FrameworkCatalogEntry extends CatalogEntryBase {
	readonly kind: "framework";
	readonly slots: ReadonlyArray<string>;
}

export interface TemplateCatalogEntry extends CatalogEntryBase {
	readonly kind: "template";
	readonly framework: string;
	readonly version: number;
}

export interface AddonCatalogEntry extends CatalogEntryBase {
	readonly kind: "addon";
	readonly capabilities?: ReadonlyArray<CapabilityId>;
	readonly frameworks?: ReadonlyArray<string>;
	readonly requiredSlots?: ReadonlyArray<ManagedSurfaceName>;
	readonly targetMode: "single" | "multiple";
}

export type CatalogEntry =
	| AddonCatalogEntry
	| FrameworkCatalogEntry
	| TemplateCatalogEntry;

type CatalogMetadata = Omit<CatalogEntryBase, "category" | "id" | "name">;

const frameworkMetadata: Record<string, CatalogMetadata> = {
	nextjs: {
		description:
			"Forge's first-party Next.js host framework with managed app surfaces and slot-aware rendering.",
		experimental: false,
		hidden: false,
		keywords: ["app", "framework", "next", "react", "web"],
		summary: "Managed Next.js app host.",
	},
};

const templateMetadata: Record<string, CatalogMetadata> = {
	"nextjs/base": {
		description:
			"A production-ready Next.js base template that composes cleanly with Forge addons.",
		experimental: false,
		hidden: false,
		keywords: ["base", "next", "starter", "template", "web"],
		summary: "Base Next.js template.",
	},
};

const addonMetadata: Record<string, CatalogMetadata> = {
	root: {
		description:
			"Internal project bootstrap metadata and root workspace shaping for managed Forge projects.",
		experimental: false,
		hidden: true,
		keywords: ["internal", "root", "workspace"],
		summary: "Internal root project bootstrap.",
	},
	pnpm: {
		description:
			"Configures pnpm workspace behavior and workspace package manager metadata.",
		experimental: false,
		hidden: false,
		keywords: ["package manager", "pnpm", "workspace"],
		summary: "Set up pnpm workspace support.",
	},
	typescript: {
		description:
			"Adds the standard TypeScript project scaffolding and managed tsconfig surfaces.",
		experimental: false,
		hidden: false,
		keywords: ["ts", "tsconfig", "typescript"],
		summary: "Add TypeScript project support.",
	},
	biome: {
		description:
			"Adds Biome formatting and linting configuration to the managed project surfaces.",
		experimental: false,
		hidden: false,
		keywords: ["biome", "formatting", "linting"],
		summary: "Add Biome formatting and linting.",
	},
	gitignore: {
		description:
			"Adds Forge's managed .gitignore entries for common generated outputs and tooling.",
		experimental: false,
		hidden: false,
		keywords: ["git", "gitignore", "tooling"],
		summary: "Add managed .gitignore entries.",
	},
	ui: {
		description:
			"Creates a reusable shared UI package with managed styling and utility surfaces.",
		experimental: false,
		hidden: false,
		keywords: ["components", "design system", "react", "ui"],
		summary: "Create a shared UI package.",
	},
	tailwind: {
		description:
			"Adds Tailwind CSS to compatible app and shared UI surfaces managed by Forge.",
		experimental: false,
		hidden: false,
		keywords: ["css", "styles", "tailwind"],
		summary: "Add Tailwind CSS support.",
	},
	trpc: {
		description:
			"Adds tRPC server and client surfaces to compatible Forge application targets.",
		experimental: false,
		hidden: false,
		keywords: ["api", "rpc", "trpc", "typescript"],
		summary: "Add tRPC to an app target.",
	},
	drizzle: {
		description:
			"Adds Drizzle ORM configuration, schema surfaces, and database tooling to a compatible app.",
		experimental: false,
		hidden: false,
		keywords: ["database", "drizzle", "orm", "sql"],
		summary: "Add Drizzle ORM support.",
	},
	"better-auth": {
		description:
			"Adds Better Auth server and client surfaces to a compatible application target.",
		experimental: false,
		hidden: false,
		keywords: ["auth", "authentication", "better-auth"],
		summary: "Add Better Auth to an app target.",
	},
};

function frameworkEntry(framework: FrameworkDefinition): FrameworkCatalogEntry {
	const metadata = frameworkMetadata[framework.id] ?? {
		description: framework.name,
		experimental: false,
		hidden: false,
		keywords: [],
		summary: framework.name,
	};

	return {
		category: "web",
		id: framework.id,
		kind: "framework",
		name: framework.name,
		slots: framework.slots,
		...metadata,
	};
}

function templateEntry(
	template: TemplateDefinition<ForgeConfig>,
): TemplateCatalogEntry {
	const metadata = templateMetadata[template.id] ?? {
		description: template.name,
		experimental: false,
		hidden: false,
		keywords: [],
		summary: template.name,
	};

	return {
		category: template.category,
		framework: template.framework,
		id: template.id,
		kind: "template",
		name: template.name,
		version: template.version,
		...metadata,
	};
}

function addonEntry(addon: AddonDefinition<ForgeConfig>): AddonCatalogEntry {
	const metadata = addonMetadata[addon.id] ?? {
		description: addon.name,
		experimental: false,
		hidden: false,
		keywords: [],
		summary: addon.name,
	};

	const frameworks = addon.compatibility?.app?.frameworks;
	const capabilities = addon.compatibility?.package?.capabilities;
	const requiredSlots = [
		...(addon.compatibility?.app?.requiredSlots ?? []),
		...(addon.compatibility?.package?.requiredSlots ?? []),
	] as ReadonlyArray<ManagedSurfaceName>;

	return {
		capabilities,
		category: addon.category,
		frameworks,
		id: addon.id,
		kind: "addon",
		name: addon.name,
		requiredSlots: requiredSlots.length > 0 ? requiredSlots : undefined,
		targetMode: addon.targetMode,
		...metadata,
	};
}

export const catalog = [
	...builtins.frameworks.map(frameworkEntry),
	...builtins.templates.map(templateEntry),
	...builtins.addons.map(addonEntry),
] as const satisfies ReadonlyArray<CatalogEntry>;

export function listCatalogEntries(kind?: CatalogKind) {
	return kind ? catalog.filter((entry) => entry.kind === kind) : [...catalog];
}

export function getCatalogEntry(id: string) {
	return catalog.find((entry) => entry.id === id);
}

export function listVisibleAddons() {
	return catalog.filter(
		(entry): entry is AddonCatalogEntry =>
			entry.kind === "addon" && entry.hidden === false,
	);
}
