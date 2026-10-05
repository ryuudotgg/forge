import { createTransport, type Transporter } from "nodemailer";
import { env } from "../env";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transport: Transporter | undefined;
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.EMAIL_FROM || !env.SMTP_URL) {
    if (env.NODE_ENV !== "development")
      throw new Error("Email isn't configured. Set EMAIL_FROM and SMTP_URL.");

    console.info(
      `Email to ${message.to}: ${message.subject}\n\n${message.text}`,
    );

    return;
  }

  transport ??= createTransport(env.SMTP_URL);

  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
