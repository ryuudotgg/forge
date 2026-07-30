import { ThemeProvider } from "next-themes";
import { Fragment, type ElementType, type ReactNode } from "react";
// __TRPC_IMPORT__

const dataProviders: { default: ElementType; trpc?: ElementType } = {
  default: Fragment,
  // __TRPC_ENTRY__
};
const DataProvider = dataProviders.trpc ?? dataProviders.default;

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <DataProvider>{children}</DataProvider>
    </ThemeProvider>
  );
}
