import type { ForgeConfig } from "../../config";
import { interpolate, readTemplate } from "../../template";

export function orpcTemplateVars(config: ForgeConfig) {
	const slug = config.slug ?? "my-app";
	const usesDb = config.orm !== undefined;
	const usesAuth = config.authentication === "better-auth";
	return {
		SLUG: slug,
		"__DB_IMPORT__;\n": usesDb
			? `import { db } from "@${slug}/db/client";\n`
			: "",
		"  __DB_CTX_TYPE__;\n": usesDb ? "  db: typeof db;\n" : "",
		"__DB_CTX_VALUE__, ": usesDb ? "db, " : "",
		"__AUTH_TYPE_IMPORT__;\n": usesAuth
			? `import type { Auth } from "@${slug}/auth";\n`
			: "",
		"__AUTH_IMPORT__;\n": usesAuth
			? `import { auth } from "@${slug}/auth";\n`
			: "",
		SESSION_TYPE: usesAuth
			? 'Awaited<ReturnType<Auth["api"]["getSession"]>>'
			: "{ user: { id: string; email: string } } | null",
		"  __CTX_AUTH_PARAM__;\n": usesAuth ? "  auth: Auth;\n" : "",
		SESSION_RESOLVE: usesAuth
			? "const session = await opts.auth.api.getSession({ headers: opts.headers });"
			: "const session = null;",
		"__AUTH_ARG__, ": usesAuth ? "auth, " : "",
		"  __ME_PROCEDURE__,\n": usesAuth
			? "  me: protectedProcedure.handler(({ context }) => ({ id: context.user.id })),\n"
			: "",
		"__PROTECTED_IMPORT__, ": usesAuth ? "protectedProcedure, " : "",
	};
}

export function renderOrpcTemplate(config: ForgeConfig, path: string): string {
	return interpolate(
		readTemplate(`api/orpc/${path}`),
		orpcTemplateVars(config),
	);
}
