import { useEffect, useState, useCallback } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';

// Manager tool: inspect and clean up the raw per-device push subscriptions of a club.
// Its main job is removing stale/duplicate registrations — e.g. an OLD subscription a device left on
// the apex origin (squadio.techbynoam.com) after the club moved to its own subdomain, which would
// otherwise deliver a second copy of every notification.

// Turn a stored segment (possibly multi-line "team:A\nteam:B") into readable Hebrew labels.
function segmentLabels(segment) {
    const raw = (segment || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!raw.length) return ['כל המועדון'];
    return raw.map((s) => {
        if (s.startsWith('team:')) return 'קבוצה: ' + s.slice(5);
        if (s === '__OPERATOR__') return 'מפעיל';
        if (s.startsWith('__TRAINER__:')) return 'מאמן: ' + s.slice('__TRAINER__:'.length);
        if (s.startsWith('__MANAGER__')) return 'מנהל';
        return s; // legacy free-text label
    });
}

export default function PushSubscribers() {
    const slug = getActiveClub().slug;
    const [data, setData] = useState(null);
    const [msg, setMsg] = useState('');
    const [busyId, setBusyId] = useState('');
    const [viewOnly, setViewOnly] = useState(false);

    const load = useCallback(() => {
        fetch(`/api/${slug}/push-subscriptions`, { headers: authHeaders(slug) })
            .then(async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) }))
            .then(({ status, d }) => {
                if (status === 401 || d.error === 'unauthorized') { setViewOnly(true); setData({ subscriptions: [] }); setMsg(''); }
                else if (d.error) { setMsg('שגיאה: ' + d.error); }
                else { setData(d); setViewOnly(false); setMsg(''); }
            })
            .catch(() => setMsg('שגיאת תקשורת'));
    }, [slug]);

    useEffect(() => { load(); }, [load]);

    const removeOne = async (id) => {
        if (!confirm('להסיר את המנוי הזה? המכשיר יפסיק לקבל התראות עד שיירשם מחדש.')) return;
        setBusyId(id); setMsg('');
        try {
            const r = await fetch(`/api/${slug}/push-subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(slug) });
            const d = await r.json().catch(() => ({ error: 'x' }));
            if (d.error) setMsg('⚠️ מחיקה נכשלה');
            else { setMsg('✓ הוסר'); load(); }
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusyId(''); }
    };

    const purgeLegacy = async () => {
        if (!confirm('להסיר את כל המנויים הישנים (מהדומיין הקודם)? זה עוצר התראות כפולות. מכשיר שרשום רק בדרך הישנה יצטרך לפתוח מחדש את האפליקציה בדומיין החדש ולאשר התראות.')) return;
        setBusyId('__purge__'); setMsg('');
        try {
            const r = await fetch(`/api/${slug}/push-subscriptions/purge-legacy`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) } });
            const d = await r.json().catch(() => ({ error: 'x' }));
            if (d.error) setMsg('⚠️ ' + d.error);
            else { setMsg(`✓ הוסרו ${d.removed || 0} מנויים ישנים`); load(); }
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusyId(''); }
    };

    const fmt = (iso) => { try { return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

    const subs = data?.subscriptions || [];
    const activeHost = data?.activeHost || null;
    const legacyCount = subs.filter((s) => s.legacy).length;

    const row = (s) => (
        <div key={s.id} style={{ background: s.legacy ? '#fef2f2' : '#f8fafc', border: `1px solid ${s.legacy ? '#fecaca' : '#e2e8f0'}`, borderRadius: 10, padding: '0.7rem 0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {segmentLabels(s.segment).map((l, i) => (
                        <span key={i} style={{ background: '#e0e7ff', color: '#3730a3', fontSize: '0.72rem', borderRadius: 8, padding: '0.1rem 0.5rem' }}>{l}</span>
                    ))}
                </div>
                <button
                    onClick={() => removeOne(s.id)}
                    disabled={busyId === s.id}
                    style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, padding: '0.3rem 0.7rem', cursor: busyId === s.id ? 'wait' : 'pointer', fontSize: '0.8rem' }}
                >{busyId === s.id ? '…' : '🗑️ הסר'}</button>
            </div>
            <div style={{ marginTop: '0.4rem', color: '#94a3b8', fontSize: '0.75rem', display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
                <span>{s.legacy ? '⚠️ דומיין ישן' : '✅ דומיין נוכחי'}{s.host ? ` · ${s.host}` : ' · (לא ידוע)'}</span>
                <span dir="ltr">…{s.endpointTail}</span>
                <span>{fmt(s.createdAt)}</span>
            </div>
        </div>
    );

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>🔔 מנויי פוש (מכשירים)</h3>
                <button onClick={load} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.4rem 0.9rem', cursor: 'pointer' }}>↻ רענן</button>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                כל המכשירים הרשומים להתראות. אפשר להסיר מנוי ישן/כפול כדי לעצור התראות כפולות.
                {msg && <b style={{ marginInlineStart: '0.5rem', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</b>}
            </p>

            {viewOnly && (
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', borderRadius: 10, padding: '0.9rem 1rem' }}>
                    מחוברים במצב תצוגה בלבד (Admin מובנה). כדי לנהל מנויי פוש — התחברו עם חשבון מנהל שנוצר ב־<b>/superuser</b>.
                </div>
            )}

            {!viewOnly && legacyCount > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '0.8rem 1rem', margin: '0.4rem 0 0.8rem' }}>
                    <div style={{ color: '#991b1b', marginBottom: '0.5rem' }}>
                        נמצאו <b>{legacyCount}</b> מנויים מהדומיין הקודם — הם עלולים לגרום להתראות כפולות.
                    </div>
                    <button
                        onClick={purgeLegacy}
                        disabled={busyId === '__purge__'}
                        style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1rem', fontWeight: 700, cursor: busyId === '__purge__' ? 'wait' : 'pointer' }}
                    >{busyId === '__purge__' ? 'מנקה…' : `🧹 נקה את כל ה${legacyCount} הישנים`}</button>
                </div>
            )}

            {!viewOnly && !data && !msg && <div style={{ color: '#94a3b8' }}>טוען…</div>}
            {!viewOnly && data && subs.length === 0 && <div style={{ color: '#94a3b8' }}>אין מנויי פוש עדיין.</div>}
            {!viewOnly && data && subs.length > 0 && (
                <div style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                    סה״כ {subs.length} מכשירים{activeHost ? ` · דומיין נוכחי: ${activeHost}` : ''}
                </div>
            )}

            <div style={{ display: 'grid', gap: '0.55rem' }}>
                {subs.map(row)}
            </div>
        </div>
    );
}
