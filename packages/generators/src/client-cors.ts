import {
	ensuredModuleTarget,
	leafTextFile,
	projectTarget,
	surfaceLines,
} from "@ryuugg/core";
import type { ForgeConfig, WebFramework } from "./config";
import { envFileLine } from "./data/providers";
import {
	hasSecondaryClients,
	secondaryClientOrigins,
	selfHostedOriginsSource,
	webDevOrigin,
} from "./origins";
import { interpolate, readTemplate, replaceAnchor } from "./template";
import { type WebAppInstance, webAppInstances } from "./web-apps";

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

	const serverUrlLines = [
		...new Set(
			webAppInstances(config)
				.filter((client) => client.client === true)
				.map((client) => serverUrlVariables[client.framework]),
		),
	].map((name) => envFileLine(name, webDevOrigin(config)));

	const clientLines =
		config.authentication === "better-auth"
			? serverUrlLines
			: [
					envFileLine("WEB_URLS", secondaryClientOrigins(config).join(",")),
					...serverUrlLines,
				];

	return [
		leafTextFile(
			ensuredModuleTarget(instance.key),
			selfHostedCorsPaths[instance.framework],
			interpolate(readTemplate("api/client-cors.ts"), {
				WEB_ORIGINS: selfHostedOriginsSource(config),
			}),
		),
		surfaceLines(projectTarget(), "rootEnv", clientLines, {
			section: "Web clients",
		}),
		surfaceLines(projectTarget(), "rootEnvExample", clientLines, {
			section: "Web clients",
		}),
	];
}

const serverUrlVariables: Readonly<Record<WebFramework, string>> = {
	nextjs: "NEXT_PUBLIC_SERVER_URL",
	"react-router": "VITE_SERVER_URL",
	"tanstack-router": "VITE_SERVER_URL",
	"tanstack-start": "VITE_SERVER_URL",
};

const selfHostedCorsPaths: Readonly<Record<WebFramework, string>> = {
	nextjs: "lib/api-cors.ts",
	"react-router": "app/lib/api-cors.ts",
	"tanstack-router": "src/lib/api-cors.ts",
	"tanstack-start": "src/lib/api-cors.ts",
};

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
		const imported = replaceAnchor(
			content,
			'from "react-router";\n',
			'from "react-router";\nimport { preflight, withCors } from "../lib/api-cors";\n',
		);

		if (imported.includes("export const loader ="))
			return imported
				.replace(
					"export const loader = (args: LoaderFunctionArgs) => handler(args);",
					'export const loader = (args: LoaderFunctionArgs) =>\n  args.request.method === "OPTIONS"\n    ? preflight(args.request)\n    : withCors(args.request, handler(args));',
				)
				.replace(
					"export const action = (args: ActionFunctionArgs) => handler(args);",
					'export const action = (args: ActionFunctionArgs) =>\n  args.request.method === "OPTIONS"\n    ? preflight(args.request)\n    : withCors(args.request, handler(args));',
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
						"  const response = fetchRequestHandler({",
					)
					.replace(
						"\n  });\n}\n\nexport const Route",
						"\n  });\n\n  return withCors(request, response);\n}\n\nexport const Route",
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
			"      POST: handler,\n      OPTIONS: ({ request }: { readonly request: Request }) =>\n        preflight(request),",
		);
	}

	return content;
}
