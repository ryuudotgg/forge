import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import type { AppRouter } from "./root";
import { appRouter, createCaller } from "./root";
import { createTRPCContext } from "./trpc";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;

export type { AppRouter, RouterInputs, RouterOutputs };
export { appRouter, createCaller, createTRPCContext, TRPCError };
