import { createFileRoute } from "@tanstack/react-router";
import { client } from "../orpc/client";

export const Route = createFileRoute("/orpc-example")({
  loader: () => client.health(),
  component: Page,
});

function Page() {
  const health = Route.useLoaderData();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">__PROJECT_NAME__</h1>
      <p data-testid="orpc-health">{health.status}</p>
    </main>
  );
}
