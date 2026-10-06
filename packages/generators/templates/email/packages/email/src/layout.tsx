/** @jsxRuntime automatic */
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Tailwind,
} from "@react-email/components";
import type { ReactNode } from "react";

interface LayoutProps {
  preview: string;
  children: ReactNode;
}

export function Layout({ preview, children }: LayoutProps) {
  return (
    <Html lang="en">
      <Tailwind>
        <Head />
        <Preview>{preview}</Preview>
        <Body className="bg-white font-sans text-zinc-900">
          <Container className="mx-auto max-w-md px-6 py-10">
            {children}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
