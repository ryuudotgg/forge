import { ServerClient } from "postmark";
import { env } from "../env";
import { type EmailMessage, renderMessage } from "./messages";

export type { EmailMessage } from "./messages";

export function canSendEmail(): boolean {
  return (
    env.NODE_ENV === "development" ||
    Boolean(env.EMAIL_FROM && env.POSTMARK_SERVER_TOKEN)
  );
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.EMAIL_FROM || !env.POSTMARK_SERVER_TOKEN) {
    if (!canSendEmail())
      throw new Error(
        "Email isn't configured. Set EMAIL_FROM and POSTMARK_SERVER_TOKEN.",
      );

    const { to, subject, text } = await renderMessage(message);
    console.info(`Email to ${to}: ${subject}\n\n${text}`);

    return;
  }

  const { to, subject, html, text } = await renderMessage(message);

  await new ServerClient(env.POSTMARK_SERVER_TOKEN).sendEmail({
    From: env.EMAIL_FROM,
    To: to,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
  });
}
