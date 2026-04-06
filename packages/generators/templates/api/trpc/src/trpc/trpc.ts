import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

export const createTRPCContext = async (opts: { headers: Headers }) => {
	return { ...opts };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ next }) => {
	throw new TRPCError({ code: "UNAUTHORIZED" });
});
