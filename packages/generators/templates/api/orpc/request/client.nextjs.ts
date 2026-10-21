
declare global {
  var $client: RouterClient<AppRouter> | undefined;
}

if (typeof window === "undefined") await import("./server");
