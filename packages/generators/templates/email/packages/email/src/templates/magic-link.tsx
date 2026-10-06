/** @jsxRuntime automatic */
import { Button, Heading, Text } from "@react-email/components";
import { Layout } from "../layout";

interface MagicLinkProps {
  url: string;
}

export function subject() {
  return "Your sign in link";
}

export default function MagicLink({ url }: MagicLinkProps) {
  return (
    <Layout preview="Your sign in link">
      <Heading className="text-xl font-semibold">Sign in</Heading>
      <Text className="text-sm text-zinc-600">
        Use the button below to sign in. The link works once.
      </Text>
      <Button
        href={url}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
      >
        Sign in
      </Button>
      <Text className="text-xs text-zinc-500">
        If you didn't request this link, you can ignore this email.
      </Text>
    </Layout>
  );
}

MagicLink.PreviewProps = {
  url: "https://app.example.com/api/auth/magic-link/verify?token=abc",
} satisfies MagicLinkProps;
