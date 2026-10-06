import { createTransport, type Transporter } from "nodemailer";
import { env } from "../env";
import { type EmailMessage, renderMessage } from "./messages";

export type { EmailMessage } from "./messages";

let transport: Transporter | undefined;
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (!env.EMAIL_FROM || !env.SMTP_URL) {
    if (env.NODE_ENV !== "development")
      throw new Error("Email isn't configured. Set EMAIL_FROM and SMTP_URL.");

    const { to, subject, text } = await renderMessage(message);
    console.info(`Email to ${to}: ${subject}\n\n${text}`);

    return;
  }

  const { to, subject, html, text } = await renderMessage(message);

  transport ??= createTransport(env.SMTP_URL);

  await transport.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
}
