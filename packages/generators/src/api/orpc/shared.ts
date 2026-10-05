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
		"__DB_CTX_VALUE__, ": usesDb ? "db, " : "",
		"__AUTH_IMPORT__;\n": usesAuth
			? `import { auth } from "@${slug}/auth";\n`
			: "",
		SESSION_TYPE: usesAuth
			? "Awaited<ReturnType<typeof auth.api.getSession>>"
			: "{ user: { id: string; email: string } } | null",
		SESSION_RESOLVE: usesAuth
			? "function resolveSession(headers: Headers): Promise<Session> {\n  return auth.api.getSession({ headers });\n}"
			: "async function resolveSession(_headers: Headers): Promise<Session> {\n  return null;\n}",
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
