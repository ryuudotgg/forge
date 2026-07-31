import type { ForgeConfig } from "../../config";
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

export function renderTrpcTemplate(config: ForgeConfig, path: string): string {
	return interpolate(
		readTemplate(`api/trpc/${path}`),
		trpcTemplateVars(config),
	);
}
