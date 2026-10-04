import {
	ensuredModuleTarget,
	leafTextFile,
	projectTarget,
	surfaceLines,
} from "@ryuugg/core";
import type { ForgeConfig } from "./config";
import { envFileLine } from "./data/providers";
import { hasSecondaryClients, secondaryClientOrigins } from "./origins";
import { interpolate, readTemplate } from "./template";
import type { WebAppInstance } from "./web-apps";

export function selfHostedCorsViteConfig(
	config: ForgeConfig,
	instance: WebAppInstance,
	content: string,
): string {
	if (
		!instance.primary ||
		(config.backend !== undefined && config.backend !== "self") ||
		!hasSecondaryClients(config)
	)
		return content;

	return content.replace(
		"defineConfig({",
		"defineConfig({\n  server: { cors: false },",
	);
}

export function selfHostedCorsContributions(
	config: ForgeConfig,
	instance: WebAppInstance,
) {
	if (
		!instance.primary ||
		(config.backend !== undefined && config.backend !== "self") ||
		!hasSecondaryClients(config)
	)
		return [];

	const originLine = envFileLine(
		"WEB_URLS",
		secondaryClientOrigins(config).join(","),
	);

	return [
		leafTextFile(
			ensuredModuleTarget(instance.key),
			instance.framework === "react-router"
				? "app/lib/api-cors.ts"
				: "src/lib/api-cors.ts",
			interpolate(readTemplate("api/client-cors.ts"), {
				WEB_ORIGINS: JSON.stringify(secondaryClientOrigins(config)),
			}),
		),
		...(config.authentication === "better-auth"
			? []
			: [
					surfaceLines(projectTarget(), "rootEnv", [originLine], {
						section: "Web clients",
					}),
					surfaceLines(projectTarget(), "rootEnvExample", [originLine], {
						section: "Web clients",
					}),
				]),
	];
}

export function selfHostedCorsRoute(
	config: ForgeConfig,
	framework: string,
	content: string,
): string {
	if (
		(config.backend !== undefined && config.backend !== "self") ||
		!hasSecondaryClients(config)
	)
		return content;

	if (framework === "react-router") {
		const imported = `import { preflight, withCors } from "../lib/api-cors";\n${content}`;
		if (imported.includes("export const loader ="))
			return imported
				.replace(
					"export const loader = (args: LoaderFunctionArgs) => handler(args);",
					'export const loader = (args: LoaderFunctionArgs) => args.request.method === "OPTIONS" ? preflight(args.request) : withCors(args.request, handler(args));',
				)
				.replace(
					"export const action = (args: ActionFunctionArgs) => handler(args);",
					'export const action = (args: ActionFunctionArgs) => args.request.method === "OPTIONS" ? preflight(args.request) : withCors(args.request, handler(args));',
				);

		return imported
			.replaceAll(
				"return auth.handler(request);",
				"return withCors(request, auth.handler(request));",
			)
			.replace(
				"export function loader({ request }: LoaderFunctionArgs) {",
				'export function loader({ request }: LoaderFunctionArgs) {\n  if (request.method === "OPTIONS") return preflight(request);',
			)
			.replace(
				"export function action({ request }: ActionFunctionArgs) {",
				'export function action({ request }: ActionFunctionArgs) {\n  if (request.method === "OPTIONS") return preflight(request);',
			);
	}

	if (framework === "tanstack-start") {
		const imported = `import { preflight, withCors } from "../../../lib/api-cors";\n${content}`;

		const wrapped = imported.includes("fetchRequestHandler")
			? imported
					.replace(
						"  return fetchRequestHandler({",
						"  return withCors(request, fetchRequestHandler({",
					)
					.replace(
						"\n  });\n}\n\nexport const Route",
						"\n  }));\n}\n\nexport const Route",
					)
			: imported.includes("rpcHandler.handle")
				? imported
						.replace(
							"if (matched) return response;",
							"if (matched) return withCors(request, response);",
						)
						.replace(
							'return new Response("Not Found", { status: 404 });',
							'return withCors(request, new Response("Not Found", { status: 404 }));',
						)
				: imported.replace(
						"  return auth.handler(request);",
						"  return withCors(request, auth.handler(request));",
					);

		return wrapped.replace(
			"      POST: handler,",
			"      POST: handler,\n      OPTIONS: ({ request }: { readonly request: Request }) => preflight(request),",
		);
	}

	return content;
}
