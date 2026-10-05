import {
	type Dependency,
	ensuredModuleTarget,
	leafTextFile,
	surfaceDependencies,
} from "@ryuugg/core";
import type { ForgeConfig, WebFramework } from "../../config";
import { standaloneApiOrigin } from "../../origins";
import { interpolate, readTemplate } from "../../template";
import { acceptInvitationSegment } from "../invitations";
import { resolveAuthPlugins } from "../plugins";

const invitationPageLayouts: Readonly<
	Record<WebFramework, { readonly path: string; readonly head: string }>
> = {
	nextjs: {
		path: `app/${acceptInvitationSegment}/[id]/page.tsx`,
		head: "nextjs",
	},
	"react-router": {
		path: `app/routes/${acceptInvitationSegment}.tsx`,
		head: "react-router",
	},
	"tanstack-router": {
		path: `src/routes/${acceptInvitationSegment}.$id.tsx`,
		head: "tanstack",
	},
	"tanstack-start": {
		path: `src/routes/${acceptInvitationSegment}.$id.tsx`,
		head: "tanstack",
	},
};

function invitationPageFramework(
	config: ForgeConfig,
): WebFramework | undefined {
	return resolveAuthPlugins(config).includes("organization")
		? config.web
		: undefined;
}

export function invitationPageContributions(config: ForgeConfig) {
	const framework = invitationPageFramework(config);
	if (framework === undefined) return [];

	const slug = config.slug ?? "my-app";
	const layout = invitationPageLayouts[framework];
	const head = interpolate(
		readTemplate(`auth/better-auth/web/heads/${layout.head}.tsx`),
		{ SLUG: slug },
	);

	const authDependency: Dependency = {
		name: `@${slug}/auth`,
		version: "workspace:*",
		type: "dependencies",
	};

	return [
		leafTextFile(
			ensuredModuleTarget("web"),
			layout.path,
			interpolate(readTemplate("auth/better-auth/web/accept-invitation.tsx"), {
				"__PAGE_HEAD__\n": head,
			}),
		),
		...(standaloneApiOrigin(config) === undefined
			? []
			: [
					surfaceDependencies(ensuredModuleTarget("web"), "packageJson", [
						authDependency,
					]),
				]),
	];
}

export function reactRouterInvitationRoute(config: ForgeConfig): string {
	return invitationPageFramework(config) === "react-router"
		? `  route("${acceptInvitationSegment}/:id", "routes/${acceptInvitationSegment}.tsx"),\n`
		: "";
}
