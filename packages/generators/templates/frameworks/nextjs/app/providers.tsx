"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";__PROVIDER_IMPORTS__

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      __PROVIDER_CHILDREN__
    </ThemeProvider>
  );
}
