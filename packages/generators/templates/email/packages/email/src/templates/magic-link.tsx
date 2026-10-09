/** @jsxRuntime automatic */
import { ActionButton, Layout } from "../layout";

interface MagicLinkProps {
  url: string;
}

export function subject() {
  return "Your sign in link";
}

export default function MagicLink({ url }: MagicLinkProps) {
  return (
    <Layout
      preview="Your sign in link"
      heading="Sign in"
      subtitle="Use the button below to sign in. The link works once."
      footnote="If you didn't request this link, you can ignore this email."
    >
      <ActionButton href={url}>Sign in</ActionButton>
    </Layout>
  );
}

MagicLink.PreviewProps = {
  url: "https://app.example.com/api/auth/magic-link/verify?token=abc",
} satisfies MagicLinkProps;
