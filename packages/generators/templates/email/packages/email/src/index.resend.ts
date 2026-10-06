import { Resend } from "resend";
import { env } from "../env";
import { type EmailMessage, renderMessage } from "./messages";

export type { EmailMessage } from "./messages";

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.EMAIL_FROM || !env.RESEND_API_KEY) {
    if (env.NODE_ENV !== "development")
      throw new Error(
        "Email isn't configured. Set EMAIL_FROM and RESEND_API_KEY.",
      );

    const { to, subject, text } = await renderMessage(message);
    console.info(`Email to ${to}: ${subject}\n\n${text}`);

    return;
  }

  const { to, subject, html, text } = await renderMessage(message);

  const { error } = await new Resend(env.RESEND_API_KEY).emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  if (error) throw new Error(error.message);
}
