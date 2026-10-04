import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { Health } from "@/orpc/health";
import { createServerORPC } from "@/orpc/server";

export default async function Page() {
  const orpc = await createServerORPC();
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery(orpc.health.queryOptions());

  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">__PROJECT_NAME__</h1>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Health />
      </HydrationBoundary>
    </main>
  );
}
