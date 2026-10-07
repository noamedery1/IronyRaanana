// Minimal mailer. Uses Resend (HTTP, no dependency) when RESEND_API_KEY is set;
// otherwise logs the email to the console (dev) so flows are testable without creds.
const FROM = process.env.MAIL_FROM || 'onboarding@resend.dev';

let last = null; // last send outcome, for /api/health (no addresses/content)
export function mailDiag() {
    return { configured: Boolean(process.env.RESEND_API_KEY), from: FROM, last };
}

export async function sendEmail(args) {
    const r = await sendEmailRaw(args);
    last = { ok: r.ok, dev: Boolean(r.dev), reason: r.reason || null, at: new Date().toISOString() };
    if (!r.ok) console.warn('[mail] send failed:', r.reason);
    return r;
}

async function sendEmailRaw({ to, subject, html }) {
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
        if (!res.ok) return { ok: false, reason: 'resend ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200) };
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}
