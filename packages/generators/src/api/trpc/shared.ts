import type { ForgeConfig } from "../../config";
import { deps } from "../../deps";
import { interpolate, readTemplate } from "../../template";

export function trpcTemplateVars(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const usesDb = config.orm !== undefined;
	const usesAuth = config.authentication === "better-auth";

	return {
		SLUG: slug,
		DB_IMPORT: usesDb ? `import { db } from "@${slug}/db/client";\n` : "",
		DB_CTX_TYPE: usesDb ? "\n  db: typeof db;" : "",
		DB_CTX_VALUE: usesDb ? " db," : "",
		AUTH_TYPE_IMPORT: usesAuth
			? `import type { Auth } from "@${slug}/auth";\n`
			: "",
		"// __AUTH_IMPORT__\n": usesAuth
			? `import { auth } from "@${slug}/auth";\n`
			: "",
		SESSION_TYPE: usesAuth
			? 'Awaited<ReturnType<Auth["api"]["getSession"]>>'
			: "{ user: { id: string; email: string } } | null",
		CTX_AUTH_PARAM: usesAuth ? "auth: Auth;\n  " : "",
		SESSION_RESOLVE: usesAuth
			? "const session = await opts.auth.api.getSession({ headers: opts.headers });"
			: "const session = null;",
		"/* __AUTH_ARG__ */ ": usesAuth ? "auth, " : "",
	};
}

export function trpcClientMarkers(frameworkId: string, standalone: boolean) {
	const serverUrl =
		frameworkId === "nextjs"
			? "env.NEXT_PUBLIC_SERVER_URL"
			: "env.VITE_SERVER_URL";

	return {
		ENV_IMPORT: standalone
			? frameworkId === "nextjs"
				? 'import { env } from "../env";\n'
				: 'import { env } from "../../env";\n'
			: "",
		API_URL: standalone ? `\`\${${serverUrl}}/api/trpc\`` : '"/api/trpc"',
		CREDENTIAL_FETCH: standalone
			? '          fetch(url, options) {\n            return globalThis.fetch(url, {\n              ...options,\n              credentials: "include",\n            });\n          },\n'
			: "",
	};
}

export function trpcRecipeMarkers(
	config: ForgeConfig,
	frameworkId: string,
	standalone: boolean,
) {
	const values = trpcTemplateVars(config);

	return {
		SLUG: values.SLUG,
		AUTH_IMPORT: values["// __AUTH_IMPORT__\n"],
		AUTH_ARG: values["/* __AUTH_ARG__ */ "],
		...trpcClientMarkers(frameworkId, standalone),
	};
}

export function trpcWebDependencies(slug: string) {
	return [
		{
			name: `@${slug}/trpc`,
			version: "workspace:*",
			type: "dependencies" as const,
		},
		{ ...deps.trpcClient, type: "dependencies" as const },
		{ ...deps.trpcReactQuery, type: "dependencies" as const },
		{ ...deps.trpcServer, type: "dependencies" as const },
		{ ...deps.tanstackReactQuery, type: "dependencies" as const },
		{ ...deps.superjson, type: "dependencies" as const },
	];
}

export function renderTrpcTemplate(config: ForgeConfig, path: string): string {
	return interpolate(
		readTemplate(`api/trpc/${path}`),
		trpcTemplateVars(config),
	);
}
