import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import { orpc } from "@/orpc/client";
import { Health } from "@/orpc/health";

export default async function Page() {
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
