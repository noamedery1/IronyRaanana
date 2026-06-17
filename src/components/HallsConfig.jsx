import { useEffect, useState, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

/**
 * Hall settings page (DB-backed). The hall list comes from the published live schedule,
 * so it works without connecting the manager's Excel. Per hall: capacity type + address.
 */
export default function HallsConfig({ clubSlug }) {
    const [halls, setHalls] = useState([]);
    const [config, setConfig] = useState({});
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/halls`).then((r) => r.json())
            .then((d) => { if (d.halls) { setHalls(d.halls); setConfig(d.config || {}); } })
            .catch(() => setMsg('שגיאת תקשורת'));
    }, [clubSlug]);

    useEffect(() => { load(); }, [load]);

    const getCfg = (hall) => config[hall] || { type: 'FULL', courts: 2, address: '' };
    const update = (hall, changes) => setConfig((prev) => ({ ...prev, [hall]: { ...getCfg(hall), ...changes } }));

    const save = async () => {
        setBusy(true); setMsg('');
        try {
            const r = await fetch(`/api/${clubSlug}/halls`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(clubSlug) },
                body: JSON.stringify({ config }),
            });
            setMsg(r.ok ? '✓ נשמר' : '❌ שמירה נכשלה');
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    return (
        <div className="cc">
            <div className="cc-toolbar">
                <div className="cc-title">🏟️ הגדרת אולמות</div>
                <button className="cc-btn green" onClick={save} disabled={busy}>{busy ? 'שומר…' : '💾 שמור'}</button>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                הגדר לכל אולם את הקיבולת (כמה קבוצות במקביל) ואת הכתובת המדויקת לניווט. הרשימה נטענת מהלו"ז שפורסם.
                {msg && <b style={{ marginInlineStart: '0.6rem', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</b>}
            </p>

            <div className="hc-grid">
                <div className="hc-head"><div>אולם</div><div>קיבולת</div><div>מגרשים</div><div>כתובת מדויקת (לניווט)</div></div>
                {halls.map(({ name: hall }) => {
                    const cfg = getCfg(hall);
                    return (
                        <div key={hall} className="hc-row">
                            <div className="hc-name">📍 {hall}</div>
                            <div className="hc-types">
                                <button className={`cc-type ${cfg.type === 'FULL' ? 'on' : ''}`} onClick={() => update(hall, { type: 'FULL' })}>מלא (1)</button>
                                <button className={`cc-type ${cfg.type === 'HALF' ? 'on' : ''}`} onClick={() => update(hall, { type: 'HALF' })}>חצי-חצי (2)</button>
                                <button className={`cc-type ${cfg.type === 'MULTI' ? 'on' : ''}`} onClick={() => update(hall, { type: 'MULTI' })}>רב-מגרשי</button>
                            </div>
                            <div>
                                {cfg.type === 'MULTI' ? (
                                    <input type="number" min="2" max="12" value={cfg.courts || 2}
                                        onChange={(e) => update(hall, { courts: Math.max(2, parseInt(e.target.value) || 2) })}
                                        className="hc-input" style={{ width: '70px', textAlign: 'center' }} />
                                ) : (<span style={{ color: 'var(--text-muted)' }}>{cfg.type === 'HALF' ? '2' : '1'}</span>)}
                            </div>
                            <div>
                                <input type="text" value={cfg.address || ''} placeholder={`${hall}, רעננה`}
                                    onChange={(e) => update(hall, { address: e.target.value })} className="hc-input" style={{ width: '100%' }} />
                            </div>
                        </div>
                    );
                })}
                {halls.length === 0 && <div style={{ color: 'var(--text-dim)', padding: '1rem' }}>אין אולמות עדיין — פרסם לו"ז כדי לטעון את הרשימה.</div>}
            </div>
        </div>
    );
}
