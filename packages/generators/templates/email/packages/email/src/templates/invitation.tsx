/** @jsxRuntime automatic */
import { Text } from "react-email";
import { ActionButton, Layout } from "../layout";

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
    <Layout
      preview={`Join ${organizationName}`}
      heading={`Join ${organizationName}`}
      subtitle={
        url === undefined
          ? `${inviterName} (${inviterEmail}) invited you to join ${organizationName}.`
          : `${inviterName} (${inviterEmail}) invited you to join ${organizationName}. Sign in as ${email}, then accept the invitation.`
      }
      footnote="If you weren't expecting this invitation, you can ignore this email."
    >
      {url === undefined ? (
        <Text className="text-center text-sm text-muted dark:text-muted-dark">
          Your invitation ID is {invitationId}.
        </Text>
      ) : (
        <ActionButton href={url}>Accept invitation</ActionButton>
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
