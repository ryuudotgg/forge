import type {
	AdapterContext,
	AdapterDefinition,
	AddonId,
	Contribution,
	EnsuredModuleTarget,
	FrameworkDefinition,
	ReadTemplate,
	RecipeMarkerValues,
	RenderedRecipeAsset,
	ResolvedModuleTarget,
	SlotPath,
	TemplateAssetDefinition,
	TemplateMarker,
	TemplateRecipeDefinition,
} from "@ryuujs/core";
import {
	defineAdapter,
	leafTextFile,
	renderRecipeAsset,
	slotPath,
} from "@ryuujs/core";

type RecipeModuleTarget = EnsuredModuleTarget | ResolvedModuleTarget;

interface RecipeAdapterOptions<
	Config,
	Addon extends AddonId,
	Markers extends Readonly<Record<string, TemplateMarker>>,
	Assets extends ReadonlyArray<TemplateAssetDefinition>,
> {
	readonly recipe: TemplateRecipeDefinition<Addon, Markers, Assets>;
	readonly frameworks: ReadonlyArray<FrameworkDefinition>;
	readonly readTemplate: ReadTemplate;
	readonly requiredSlots?: ReadonlyArray<string>;
	readonly markers: (
		context: AdapterContext<Config>,
	) => RecipeMarkerValues<Markers>;
	readonly target: (
		asset: Assets[number],
		context: AdapterContext<Config>,
	) => RecipeModuleTarget;
	readonly include?: (
		asset: Assets[number],
		context: AdapterContext<Config>,
	) => boolean;
	readonly path?: (
		asset: Assets[number],
		rendered: RenderedRecipeAsset,
		context: AdapterContext<Config>,
	) => string | SlotPath;
	readonly before?: (
		context: AdapterContext<Config>,
	) => ReadonlyArray<Contribution>;
	readonly after?: (
		context: AdapterContext<Config>,
	) => ReadonlyArray<Contribution>;
}

export function deriveRecipeAdapters<
	Config,
	const Addon extends AddonId,
	const Markers extends Readonly<Record<string, TemplateMarker>>,
	const Assets extends ReadonlyArray<TemplateAssetDefinition>,
>(
	options: RecipeAdapterOptions<Config, Addon, Markers, Assets>,
): ReadonlyArray<AdapterDefinition<Config, Addon>> {
	return options.frameworks.map((framework) =>
		defineAdapter<Config, Addon>({
			addon: options.recipe.addon,
			framework: framework.id,
			requiredSlots: options.requiredSlots,
			contribute: (context) => {
				const markers = options.markers(context);
				const recipeContributions = options.recipe.assets
					.filter((asset) => options.include?.(asset, context) ?? true)
					.map((asset) => {
						const rendered = renderRecipeAsset(
							options.recipe,
							asset,
							framework,
							{
								markers,
								readTemplate: options.readTemplate,
								slots: context.slots,
							},
						);
						const target = options.target(asset, context);
						const path =
							options.path?.(asset, rendered, context) ??
							(asset._tag === "SlotAssetDefinition"
								? slotPath(target, asset.slot)
								: rendered.destination);

						return leafTextFile(target, path, rendered.content);
					});

				return [
					...(options.before?.(context) ?? []),
					...recipeContributions,
					...(options.after?.(context) ?? []),
				];
			},
		}),
	);
}
