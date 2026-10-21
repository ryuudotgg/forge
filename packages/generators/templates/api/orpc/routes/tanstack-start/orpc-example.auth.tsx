import { ORPCError } from "@orpc/client";
import { createFileRoute } from "@tanstack/react-router";
import { client } from "../orpc/client";

export const Route = createFileRoute("/orpc-example")({
  loader: () =>
    client.me().catch((error: unknown) => {
      if (error instanceof ORPCError && error.code === "UNAUTHORIZED")
        return null;

      throw error;
    }),
  component: Page,
});

function Page() {
  const user = Route.useLoaderData();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">__PROJECT_NAME__</h1>
      <p data-testid="orpc-me">{user?.id ?? "Signed out"}</p>
    </main>
  );
}
