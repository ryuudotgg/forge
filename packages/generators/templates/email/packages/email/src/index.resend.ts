import { Resend } from "resend";
import { env } from "../env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.EMAIL_FROM || !env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "Email isn't configured. Set EMAIL_FROM and RESEND_API_KEY.",
      );
    }

    console.info(
      `Email to ${message.to}: ${message.subject}\n\n${message.text}`,
    );
    return;
  }

  const { error } = await new Resend(env.RESEND_API_KEY).emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  if (error) throw new Error(error.message);
}
