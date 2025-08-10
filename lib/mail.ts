import nodemailer from "nodemailer";

export async function sendMatchesEmail(matches: { wishlist: string; feedTitle: string; link?: string; pubDate?: string; }[]) {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, ALERT_EMAILS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_EMAILS) return;

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || "false") === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const subject = `New digital/DVD matches: ${matches.map(m => m.wishlist).join(", ").slice(0, 120)}`;
  const text = matches.map(m =>
    `• ${m.wishlist}\n   Feed: ${m.feedTitle}\n   Link: ${m.link}\n   Date: ${m.pubDate || "n/a"}`
  ).join("\n\n");

  await transport.sendMail({
    from: SMTP_USER,
    to: ALERT_EMAILS,
    subject,
    text,
  });
}
