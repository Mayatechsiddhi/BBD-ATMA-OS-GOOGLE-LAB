import nodemailer from "nodemailer";
import { readEnv } from "./env";
export async function sendAccountEmail(
  to: string,
  subject: string,
  url: string,
) {
  const env = readEnv();
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: process.env.NODE_ENV === "production" && env.SMTP_PORT !== 465,
    ...(env.SMTP_USER
      ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
      : {}),
  });
  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text: `${subject} for BBD Master ATMA OS.\n\n${url}\n\nIf you did not request this, ignore this message.`,
  });
}
