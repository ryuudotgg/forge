__DB_IMPORT__import { initTRPC, TRPCError } from "@trpc/server";
import SuperJSON from "superjson";
import { ZodError, z } from "zod";

type Session = {
  user: { id: string; email: string };
};

type TRPCContext = {__DB_CTX_TYPE__
  headers: Headers;
  session: Session | null;
};

export async function createTRPCContext(opts: {
  headers: Headers;
  session: Session | null;
}): Promise<TRPCContext> {
  return {__DB_CTX_VALUE__ headers: opts.headers, session: opts.session };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: SuperJSON,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? z.treeifyError(error.cause) : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();
  const end = Date.now();

  console.info(`[TRPC] ${path} took ${end - start}ms`);

  return result;
});

export const publicProcedure = t.procedure.use(timingMiddleware);

export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user)
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Unauthorized" });

    return next({ ctx: { session: ctx.session, user: ctx.session.user } });
  });
