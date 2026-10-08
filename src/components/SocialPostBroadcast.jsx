import { useState } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';
import { sportEmoji } from '../sportLabels.js';

// Manager tool: right after publishing on Facebook / Instagram / TikTok, push the new
// post to every parent in the club. Reuses the existing broadcast path (segment '' =
// whole club) with a `url` so tapping the notification opens the post on that network.
export default function SocialPostBroadcast() {
    const [link, setLink] = useState('');
    const [headline, setHeadline] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);
    const [nativeOnly, setNativeOnly] = useState(false); // send only to the store apps (FCM/APNs), not web

    const slug = getActiveClub().slug;

    // Pick a title from the link's host so the notification names the right network.
    const titleFor = (url) => {
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { /* ignore */ }
        if (host.includes('facebook.com') || host.includes('fb.watch') || host.includes('fb.com')) return '📣 פוסט חדש בפייסבוק';
        if (host.includes('instagram.com')) return '📸 פוסט חדש באינסטגרם';
        if (host.includes('tiktok.com')) return '🎵 סרטון חדש בטיקטוק';
        return '📣 פוסט חדש';
    };

    const send = async () => {
        const url = link.trim();
        if (!/^https?:\/\//i.test(url)) { setMsg('הדבק קישור תקין לפוסט (מתחיל ב-http)'); return; }
        setBusy(true); setMsg('');
        try {
            const r = await fetch(`/api/${slug}/broadcast`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
                body: JSON.stringify({
                    segment: '',
                    title: titleFor(url),
                    body: headline.trim() || `צפו בפוסט החדש שלנו! ${sportEmoji()}`,
                    url,
                    icon: '/social-push-192.png',
                    tag: 'club-post',
                    channel: nativeOnly ? 'native' : 'all',
                }),
            });
            const d = await r.json().catch(() => ({ error: 'x' }));
            if (d.error) setMsg('⚠️ השליחה נכשלה');
            else { setMsg(`✓ נשלח ל-${d.sent || 0} מכשירים${d.failed ? `, ${d.failed} נכשלו` : ''}`); setLink(''); setHeadline(''); }
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    const input = { width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>📣 פרסום ברשתות</h3>
            <p style={{ color: '#666', marginTop: 0 }}>פרסמתם פוסט בפייסבוק / אינסטגרם / טיקטוק? הדביקו את הקישור וכל ההורים יקבלו התראת פוש. לחיצה על ההתראה תפתח את הפוסט ישירות.</p>

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>קישור לפוסט</label>
            <input type="url" value={link} onChange={(e) => setLink(e.target.value)} dir="ltr"
                placeholder="https://instagram.com/p/..." style={input} />

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>כותרת (לא חובה)</label>
            <input type="text" value={headline} onChange={(e) => setHeadline(e.target.value)}
                placeholder={`לדוגמה: תמונות מהמשחק אתמול! ${sportEmoji()}`} style={input} />

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.8rem', padding: '0.6rem 0.8rem', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={nativeOnly} onChange={(e) => setNativeOnly(e.target.checked)} />
                <span>📱 שליחה <b>רק לאפליקציות</b> (Android/iOS) — לא לדפדפן/ווב-פוש</span>
            </label>

            <button onClick={send} disabled={busy} style={{ marginTop: '1rem', background: '#ff7a18', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'שולח...' : (nativeOnly ? '📱 שלח לאפליקציות' : '🔔 שלח לכל ההורים')}
            </button>
            {msg && <div style={{ marginTop: '1rem', fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</div>}
        </div>
    );
}
