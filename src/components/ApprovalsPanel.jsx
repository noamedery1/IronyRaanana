import { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

// Manager tool: review trainer change-requests and approve/reject. Approval mutates
// the live schedule in the DB and pushes the affected team.
const TYPE_LABEL = { cancel: 'ביטול', change: 'שינוי', move: 'העברת יום', propose: 'הצעת שיבוץ' };

export default function ApprovalsPanel({ clubSlug }) {
    const [requests, setRequests] = useState([]);
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/requests?status=pending`, { headers: authHeaders(clubSlug) }).then((r) => r.json())
            .then((d) => setRequests(d.requests || [])).catch(() => {});
    }, [clubSlug]);

    useEffect(() => { load(); }, [load]);

    const act = async (id, action) => {
        setBusy(true); setMsg('');
        try {
            const r = await fetch(`/api/${clubSlug}/requests/${id}/${action}`, { method: 'POST', headers: authHeaders(clubSlug) });
            const d = await r.json();
            if (d.error) setMsg('שגיאה: ' + d.error);
            else setMsg(action === 'approve' ? ('✓ אושר' + (d.message ? ' — ' + d.message : '')) : '✓ נדחה');
            load();
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>✅ בקשות לאישור</h3>
            <p style={{ color: '#475569' }}>בקשות שינוי ממאמנים. אישור מעדכן את הלוז החי ב-DB ושולח התראה לקבוצה.</p>
            {msg && <div style={{ margin: '0.5rem 0', fontWeight: 'bold', color: msg.startsWith('✓') ? '#16a34a' : '#ef4444' }}>{msg}</div>}

            {requests.length === 0 ? (
                <div style={{ color: '#94a3b8', padding: '1rem 0' }}>אין בקשות ממתינות 🎉</div>
            ) : (
                <div style={{ display: 'grid', gap: '0.6rem' }}>
                    {requests.map((r) => {
                        const p = r.proposed || {};
                        return (
                            <div key={r.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.9rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    <div>
                                        <span style={{ background: '#e0e7ff', color: '#3730a3', borderRadius: 8, padding: '0.15rem 0.6rem', fontSize: '0.8rem', fontWeight: 700 }}>
                                            {TYPE_LABEL[r.type] || r.type}
                                        </span>
                                        <b style={{ marginInlineStart: '0.5rem' }}>{p.team || r.session_team}</b>
                                        <span style={{ color: '#64748b' }}> · {p.day} {p.time || r.session_time || ''}</span>
                                    </div>
                                    <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{r.requested_by}</div>
                                </div>
                                {(p.newTime || p.newLocation || p.newDay) && (
                                    <div style={{ color: '#0f766e', fontSize: '0.9rem', marginTop: '0.3rem' }}>
                                        ← {p.newDay ? `יום ${p.newDay} ` : ''}{p.newTime || ''}{p.newLocation ? ' · ' + p.newLocation : ''}
                                    </div>
                                )}
                                {r.reason && <div style={{ color: '#475569', fontSize: '0.88rem', marginTop: '0.3rem' }}>סיבה: {r.reason}</div>}
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.7rem' }}>
                                    <button onClick={() => act(r.id, 'approve')} disabled={busy} style={{ background: '#16a34a', color: 'white', border: 'none', padding: '0.5rem 1.1rem', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>אשר</button>
                                    <button onClick={() => act(r.id, 'reject')} disabled={busy} style={{ background: 'white', color: '#dc2626', border: '1px solid #fca5a5', padding: '0.5rem 1.1rem', borderRadius: 8, cursor: 'pointer' }}>דחה</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
