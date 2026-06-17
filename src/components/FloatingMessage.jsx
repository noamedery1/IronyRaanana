import { useEffect, useState, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

// Floating banner message shown at the top of the public site. DB-backed, with on/off.
export default function FloatingMessage({ clubSlug }) {
    const [enabled, setEnabled] = useState(false);
    const [text, setText] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/settings/floatingMessage`).then((r) => r.json())
            .then((d) => { const v = d.value || {}; setEnabled(!!v.enabled); setText(v.text || ''); })
            .catch(() => {});
    }, [clubSlug]);

    useEffect(() => { load(); }, [load]);

    const save = async () => {
        setBusy(true); setMsg('');
        try {
            const r = await fetch(`/api/${clubSlug}/settings/floatingMessage`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(clubSlug) },
                body: JSON.stringify({ value: { enabled, text } }),
            });
            setMsg(r.ok ? '✓ נשמר ופורסם' : '❌ נכשל');
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    return (
        <div className="cc">
            <div className="cc-toolbar">
                <div className="cc-title">📣 הודעה צפה</div>
                <button className="cc-btn green" onClick={save} disabled={busy}>{busy ? 'שומר…' : '💾 שמור ופרסם'}</button>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                הודעה שרצה כבאנר בראש האתר לכל ההורים. אפשר להדליק/לכבות מתי שרוצים.
                {msg && <b style={{ marginInlineStart: '0.6rem', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</b>}
            </p>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', cursor: 'pointer', fontWeight: 700 }}>
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
                {enabled ? 'הבאנר מוצג באתר 🟢' : 'הבאנר כבוי ⚪'}
            </label>

            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="לדוגמה: משחק בית מול הפועל ת״א — שבת 19:00 · הרשמה למחנה הקיץ נפתחה"
                className="cm-textarea"
                style={{ width: '100%', maxWidth: 720 }}
            />
        </div>
    );
}
