__AUTH_TYPE_IMPORT__;
__DB_IMPORT__;
import { ORPCError, os } from "@orpc/server";

type Session = __SESSION_TYPE__;

type Context = {
  __DB_CTX_TYPE__;
  headers: Headers;
  session: Session;
};

export async function createORPCContext(opts: {
  __CTX_AUTH_PARAM__;
  headers: Headers;
}): Promise<Context> {
  __SESSION_RESOLVE__
  return { __DB_CTX_VALUE__, headers: opts.headers, session };
}

export const publicProcedure = os.$context<Context>();

export const protectedProcedure = publicProcedure.use(({ context, next }) => {
  if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
  return next({
    context: { session: context.session, user: context.session.user },
  });
});
