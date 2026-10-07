import {
	type AuthMethod,
	type AuthPlugin,
	authMethods,
	authPlugins,
	type ForgeConfig,
} from "../config";
import { resolveAuthMethods } from "./methods";
import { type AuthPluginDefinition, authPluginDefinitions } from "./plugins";

export type AuthChoice =
	| { readonly kind: "method"; readonly id: AuthMethod }
	| { readonly kind: "plugin"; readonly id: AuthPlugin };

export function authChoice(value: string): AuthChoice | undefined {
	const method = authMethods.normalize(value);
	if (method !== undefined) return { kind: "method", id: method };

	const plugin = authPlugins.normalize(value);
	return plugin === undefined ? undefined : { kind: "plugin", id: plugin };
}

export function authChoiceLabel(choice: AuthChoice): string {
	return choice.kind === "method"
		? authMethods.label(choice.id)
		: authPlugins.label(choice.id);
}

export function hasAuthChoice(
	config: ForgeConfig,
	choice: AuthChoice,
): boolean {
	if (config.authentication !== "better-auth") return false;

	const choices =
		choice.kind === "method"
			? config.authMethods === undefined
				? resolveAuthMethods(config)
				: config.authMethods
			: (config.authPlugins ?? []);

	return Array.isArray(choices) && choices.includes(choice.id);
}

export function configWithAuthChoice(
	config: ForgeConfig,
	choice: AuthChoice,
	present: boolean,
): ForgeConfig {
	if (choice.kind === "method") {
		const current = config.authMethods ?? resolveAuthMethods(config);
		return {
			...config,
			authMethods: authMethods.ids.filter((id) =>
				id === choice.id ? present : current.includes(id),
			),
		};
	}

	const current = config.authPlugins ?? [];
	const plugins = authPlugins.ids.filter((id) =>
		id === choice.id ? present : current.includes(id),
	);

	const { authPlugins: _plugins, ...rest } = config;
	return plugins.length === 0 ? rest : { ...config, authPlugins: plugins };
}

export function authChoiceChangesSchema(choice: AuthChoice): boolean {
	const id = choice.id;
	if (id === "email-password" || id === "google" || id === "apple")
		return false;

	const definition: AuthPluginDefinition = authPluginDefinitions[id];
	return definition.tables !== undefined || definition.fields !== undefined;
}
