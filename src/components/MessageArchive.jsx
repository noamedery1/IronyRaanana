import { useEffect, useState, useCallback } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';

// Archive of manager broadcasts — review what was sent, and resend any message as-is.
export default function MessageArchive() {
    const slug = getActiveClub().slug;
    const [items, setItems] = useState(null);
    const [msg, setMsg] = useState('');
    const [busyId, setBusyId] = useState('');

    const load = useCallback(() => {
        fetch(`/api/${slug}/messages`, { headers: authHeaders(slug) })
            .then((r) => r.json())
            .then((d) => { if (d.error) setMsg('שגיאה: ' + d.error); else { setItems(d.messages || []); setMsg(''); } })
            .catch(() => setMsg('שגיאת תקשורת'));
    }, [slug]);

    useEffect(() => { load(); }, [load]);

    const resend = async (e) => {
        if (!confirm(`לשלוח שוב את ההודעה אל "${e.target || 'כל המועדון'}"?`)) return;
        setBusyId(e.id); setMsg('');
        try {
            const r = await fetch(`/api/${slug}/messages`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
                body: JSON.stringify({ title: e.title, body: e.body, target: e.target, segments: e.segments }),
            });
            const d = await r.json().catch(() => ({ error: 'x' }));
            if (d.error) setMsg('⚠️ שליחה נכשלה');
            else { setMsg(`✓ נשלח שוב (${d.sent || 0} מכשירים${d.failed ? `, ${d.failed} נכשלו` : ''})`); load(); }
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusyId(''); }
    };

    const fmt = (iso) => { try { return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>🗂️ ארכיון הודעות</h3>
                <button onClick={load} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.4rem 0.9rem', cursor: 'pointer' }}>↻ רענן</button>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                כל ההודעות שנשלחו. אפשר לראות מה נשלח ולמי — ולשלוח שוב בלחיצה.
                {msg && <b style={{ marginInlineStart: '0.5rem', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</b>}
            </p>

            {!items && !msg && <div style={{ color: '#94a3b8' }}>טוען…</div>}
            {items && items.length === 0 && <div style={{ color: '#94a3b8' }}>עדיין לא נשלחו הודעות.</div>}

            <div style={{ display: 'grid', gap: '0.6rem' }}>
                {items && items.map((e) => (
                    <div key={e.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.8rem 0.9rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, color: '#1e3a8a' }}>{e.target || 'כל המועדון'}</span>
                            <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{fmt(e.at)}</span>
                        </div>
                        <div style={{ margin: '0.4rem 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{e.body}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                ✅ {e.sent} מכשירים{e.failed ? ` · ⚠️ ${e.failed} נכשלו` : ''}
                            </span>
                            <button
                                onClick={() => resend(e)}
                                disabled={busyId === e.id}
                                style={{ background: '#ff7a18', color: '#fff', border: 'none', borderRadius: 8, padding: '0.45rem 0.9rem', fontWeight: 700, cursor: busyId === e.id ? 'wait' : 'pointer' }}
                            >{busyId === e.id ? 'שולח…' : '🔁 שלח שוב'}</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
