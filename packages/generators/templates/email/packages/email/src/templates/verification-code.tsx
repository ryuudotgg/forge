/** @jsxRuntime automatic */
import { Heading, Text } from "@react-email/components";
import { Layout } from "../layout";

interface VerificationCodeProps {
  code: string;
  type: string;
}

export function subject({ type }: VerificationCodeProps) {
  switch (type) {
    case "sign-in":
      return "Your sign in code";

    case "email-verification":
      return "Verify your email";

    case "forget-password":
      return "Your password reset code";

    default:
      return "Your verification code";
  }
}

export default function VerificationCode(props: VerificationCodeProps) {
  return (
    <Layout preview={subject(props)}>
      <Heading className="text-xl font-semibold">{subject(props)}</Heading>
      <Text className="text-sm text-zinc-600">
        Enter this code to continue.
      </Text>
      <Text className="text-2xl font-semibold tracking-widest">
        {props.code}
      </Text>
      <Text className="text-xs text-zinc-500">
        If you didn't request this code, you can ignore this email.
      </Text>
    </Layout>
  );
}
