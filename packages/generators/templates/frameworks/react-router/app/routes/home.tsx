import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "__PROJECT_NAME__" },
    { name: "description", content: "Welcome to __PROJECT_NAME__." },
  ];
}

export default function Home() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-20">
      <h1 className="text-4xl font-bold tracking-tight">__PROJECT_NAME__</h1>
    </main>
  );
}
