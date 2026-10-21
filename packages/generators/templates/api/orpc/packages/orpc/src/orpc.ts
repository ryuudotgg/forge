__AUTH_IMPORT__;
__DB_IMPORT__;
import { ORPCError, os } from "@orpc/server";

type Session = __SESSION_TYPE__;

__SESSION_RESOLVE__

const reportedErrors = new WeakSet<ORPCError<string, unknown>>();
function reported(error: unknown) {
  const wrapper =
    error instanceof ORPCError
      ? new ORPCError(error.code, {
          defined: error.defined,
          status: error.status,
          message: error.message,
          data: error.data,
          cause: error,
        })
      : new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Internal server error",
          cause: error,
        });

  reportedErrors.add(wrapper);
  return wrapper;
}

export function reportServerError(error: unknown, path: string) {
  if (error instanceof ORPCError && error.status < 500) return;
  if (error instanceof ORPCError && reportedErrors.has(error)) return;
  console.error(`❌ oRPC failed on ${path}:`, error);
}

export const publicProcedure = os
  .$context<{ headers: Headers }>()
  .use(async ({ context, path, next }) => {
    try {
      const session = await resolveSession(context.headers);
      return await next({ context: { __DB_CTX_VALUE__, session } });
    } catch (error) {
      if (error instanceof ORPCError && error.status < 500) throw error;
      reportServerError(error, path.join("."));
      throw reported(error);
    }
  });

export const protectedProcedure = publicProcedure.use(({ context, next }) => {
  if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
  return next({
    context: { session: context.session, user: context.session.user },
  });
});
