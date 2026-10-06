/** @jsxRuntime automatic */
import { Button, Heading, Text } from "react-email";
import { Layout } from "../layout";

interface InvitationProps {
  email: string;
  inviterName: string;
  inviterEmail: string;
  organizationName: string;
  invitationId: string;
  url?: string;
}

export function subject({ inviterName, organizationName }: InvitationProps) {
  return `${inviterName} invited you to ${organizationName}`;
}

export default function Invitation({
  email,
  inviterName,
  inviterEmail,
  organizationName,
  invitationId,
  url,
}: InvitationProps) {
  return (
    <Layout preview={`Join ${organizationName}`}>
      <Heading className="text-xl font-semibold">
        Join {organizationName}
      </Heading>
      <Text className="text-sm text-zinc-600">
        {inviterName} ({inviterEmail}) invited you to join {organizationName}.
      </Text>
      {url === undefined ? (
        <Text className="text-sm text-zinc-600">
          Your invitation ID is {invitationId}.
        </Text>
      ) : (
        <>
          <Text className="text-sm text-zinc-600">
            Sign in as {email}, then accept the invitation.
          </Text>
          <Button
            href={url}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
          >
            Accept invitation
          </Button>
        </>
      )}
    </Layout>
  );
}

Invitation.PreviewProps = {
  email: "invitee@example.com",
  inviterName: "Ada",
  inviterEmail: "ada@example.com",
  organizationName: "Lumen Works",
  invitationId: "inv_123",
  url: "https://app.example.com/accept-invitation/inv_123",
} satisfies InvitationProps;
