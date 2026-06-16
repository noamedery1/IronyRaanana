// Minimal mailer. Uses Resend (HTTP, no dependency) when RESEND_API_KEY is set;
// otherwise logs the email to the console (dev) so flows are testable without creds.
const FROM = process.env.MAIL_FROM || 'onboarding@resend.dev';

export async function sendEmail({ to, subject, html }) {
    if (!to) return { ok: false, reason: 'no recipient' };
    const key = process.env.RESEND_API_KEY;
    if (!key) {
        console.log(`[mail:dev] -> ${to} | ${subject}`);
        return { ok: true, dev: true };
    }
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: FROM, to, subject, html }),
        });
        if (!res.ok) return { ok: false, reason: 'resend ' + res.status };
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}
