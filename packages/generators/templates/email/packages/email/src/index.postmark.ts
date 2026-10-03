import { ServerClient } from "postmark";
import { env } from "../env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.EMAIL_FROM || !env.POSTMARK_SERVER_TOKEN) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "Email isn't configured. Set EMAIL_FROM and POSTMARK_SERVER_TOKEN.",
      );
    }

    console.info(
      `Email to ${message.to}: ${message.subject}\n\n${message.text}`,
    );
    return;
  }

  await new ServerClient(env.POSTMARK_SERVER_TOKEN).sendEmail({
    From: env.EMAIL_FROM,
    To: message.to,
    Subject: message.subject,
    TextBody: message.text,
    HtmlBody: message.html,
  });
}
