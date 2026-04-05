import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.FROM_EMAIL ?? "Quydly <noreply@quydly.com>";
const APP_URL = process.env.APP_URL ?? "https://quydly.com";

/**
 * Send the daily "questions are ready" notification to a batch of emails.
 * Resend supports up to 50 recipients per batch call.
 */
export async function sendDailyNotification(emails) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping notifications");
    return;
  }
  if (!emails.length) {
    console.log("[email] no subscribers to notify");
    return;
  }

  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // Resend batch: array of individual message objects
  const messages = emails.map((to) => ({
    from: FROM,
    to,
    subject: `Your daily Quydly quiz is ready ☀️`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin-top:0">Today's quiz is live 🗞️</h2>
        <p style="color:#555">It's ${date}. 5 fresh questions, ~3 minutes. See how much you know about today's news.</p>
        <a href="${APP_URL}"
           style="display:inline-block;margin-top:16px;padding:12px 24px;background:#1a1a1a;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          Play today's quiz
        </a>
        <p style="margin-top:32px;font-size:12px;color:#aaa">
          You're receiving this because you signed up for Quydly daily reminders.<br>
          <a href="${APP_URL}/unsubscribe" style="color:#aaa">Unsubscribe</a>
        </p>
      </div>
    `,
  }));

  // Resend batch endpoint handles up to 100 messages per call
  const CHUNK = 100;
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const { data, error } = await resend.batch.send(chunk);
    if (error) {
      console.error(`[email] batch send failed (chunk ${i / CHUNK}):`, error);
    } else {
      console.log(`[email] sent ${chunk.length} notifications (chunk ${i / CHUNK + 1})`);
    }
  }
}
