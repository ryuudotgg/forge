import { __PROTECTED_IMPORT__, publicProcedure } from "./orpc";

export const appRouter = {
  health: publicProcedure.handler(() => ({ status: "ok" as const })),
  __ME_PROCEDURE__,
};

export type AppRouter = typeof appRouter;
