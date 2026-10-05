__AUTH_IMPORT__;
__DB_IMPORT__;
import { ORPCError, os } from "@orpc/server";

type Session = __SESSION_TYPE__;

__SESSION_RESOLVE__

// Procedure errors reach both the middleware below and each onError.
const reportedErrors = new WeakSet<object>();
export function reportServerError(error: unknown, path: string) {
  if (error instanceof ORPCError && error.status < 500) return;

  if (typeof error === "object" && error !== null) {
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
  }

  console.error(`❌ oRPC failed on ${path}:`, error);
}

export const publicProcedure = os
  .$context<{ headers: Headers }>()
  .use(async ({ context, path, next }) => {
    try {
      const session = await resolveSession(context.headers);
      return await next({ context: { __DB_CTX_VALUE__, session } });
    } catch (error) {
      reportServerError(error, path.join("."));
      throw error;
    }
  });

export const protectedProcedure = publicProcedure.use(({ context, next }) => {
  if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
  return next({
    context: { session: context.session, user: context.session.user },
  });
});
