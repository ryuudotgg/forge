/** @jsxRuntime automatic */
import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Tailwind,
  type TailwindConfig,
  Text,
} from "react-email";

const theme: TailwindConfig = {
  theme: {
    extend: {
      borderRadius: { md: "8px" },
      colors: {
        background: { DEFAULT: "#ffffff", dark: "#09090b" },
        foreground: { DEFAULT: "#18181b", dark: "#fafafa" },
        muted: { DEFAULT: "#71717a", dark: "#a1a1aa" },
        card: { DEFAULT: "#fafafa", dark: "#18181b" },
        border: { DEFAULT: "#e4e4e7", dark: "#27272a" },
        primary: { DEFAULT: "#18181b", dark: "#e4e4e7" },
        "primary-foreground": { DEFAULT: "#fafafa", dark: "#18181b" },
      },
    },
  },
};

interface LayoutProps {
  preview: string;
  heading?: string;
  subtitle?: string;
  footnote?: string;
  children: ReactNode;
}

export function Layout({
  preview,
  heading,
  subtitle,
  footnote,
  children,
}: LayoutProps) {
  return (
    <Html lang="en">
      <Tailwind config={theme}>
        <Head>
          <meta name="color-scheme" content="light dark" />
          <meta name="supported-color-schemes" content="light dark" />
        </Head>
        <Preview>{preview}</Preview>
        <Body className="m-0 p-0 font-sans dark:bg-background-dark">
          <Section className="bg-background text-foreground dark:bg-background-dark dark:text-foreground-dark">
            <Container className="mx-auto max-w-[600px] px-5 py-[60px] max-sm:px-2">
              {heading === undefined && subtitle === undefined ? null : (
                <Section className="mb-6">
                  {heading === undefined ? null : (
                    <Heading className="mb-2 text-center text-xl font-bold">
                      {heading}
                    </Heading>
                  )}
                  {subtitle === undefined ? null : (
                    <Text className="m-0 text-center text-sm text-muted dark:text-muted-dark">
                      {subtitle}
                    </Text>
                  )}
                </Section>
              )}
              {children}
              {footnote === undefined ? null : (
                <Section className="mx-auto mt-6 max-w-[400px]">
                  <Text className="m-0 text-center text-sm leading-5 text-muted dark:text-muted-dark">
                    {footnote}
                  </Text>
                </Section>
              )}
            </Container>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  );
}

export function ActionButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Section className="text-center">
      <Button
        href={href}
        className="rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground dark:bg-primary-dark dark:text-primary-foreground-dark"
      >
        {children}
      </Button>
    </Section>
  );
}
