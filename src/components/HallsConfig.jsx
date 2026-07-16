import { useEffect, useState, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';
import { venue, venues } from '../sportLabels.js';

/**
 * Venue settings page (DB-backed). The list comes from the published live schedule AND
 * from venues added manually here, so a brand-new club can define its fields/halls before
 * any schedule exists. Per venue: capacity type + address. Wording is sport-aware
 * (football → מגרש/מגרשים, basketball → אולם/אולמות).
 */
export default function HallsConfig({ clubSlug }) {
    const [halls, setHalls] = useState([]);
    const [config, setConfig] = useState({});
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);
    const [newField, setNewField] = useState('');
    const V1 = venue();   // singular: מגרש / אולם
    const Vn = venues();  // plural:   מגרשים / אולמות

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/halls`).then((r) => r.json())
            .then((d) => { if (d.halls) { setHalls(d.halls); setConfig(d.config || {}); } })
            .catch(() => setMsg('שגיאת תקשורת'));
    }, [clubSlug]);

    useEffect(() => { load(); }, [load]);

    const getCfg = (hall) => config[hall] || { type: 'FULL', courts: 2, address: '' };
    const update = (hall, changes) => setConfig((prev) => ({ ...prev, [hall]: { ...getCfg(hall), ...changes } }));

    // Add a venue by hand (no published schedule needed). It appears immediately and is
    // persisted on save (listHalls merges saved config names into the list).
    const addField = () => {
        const n = newField.trim();
        if (!n) return;
        if (config[n] || halls.some((h) => h.name === n)) { setMsg('❌ כבר קיים'); return; }
        setConfig((prev) => ({ ...prev, [n]: { type: 'FULL', courts: 2, address: '', color: '#3b82f6' } }));
        setHalls((prev) => [...prev, { name: n }].sort((a, b) => a.name.localeCompare(b.name, 'he')));
        setNewField(''); setMsg(`➕ נוסף "${n}" — לחץ 💾 שמור`);
    };

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
                <div className="cc-title">🏟️ הגדרת {Vn}</div>
                <button className="cc-btn green" onClick={save} disabled={busy}>{busy ? 'שומר…' : '💾 שמור'}</button>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                הגדר לכל {V1} את הקיבולת (כמה קבוצות במקביל) ואת הכתובת המדויקת לניווט. הרשימה נטענת מהלו"ז שפורסם ומ{Vn} שהוספת ידנית.
                {msg && <b style={{ marginInlineStart: '0.6rem', color: (msg.startsWith('✓') || msg.startsWith('➕')) ? '#10b981' : '#ef4444' }}>{msg}</b>}
            </p>

            {/* Add a venue by hand — lets a new club start without a published schedule */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', maxWidth: 420 }}>
                <input type="text" value={newField} placeholder={`שם ${V1} חדש`}
                    onChange={(e) => setNewField(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addField(); }}
                    className="hc-input" style={{ flex: 1 }} />
                <button className="cc-btn blue" onClick={addField}>➕ הוסף {V1}</button>
            </div>

            <div className="hc-grid">
                <div className="hc-head"><div>{V1}</div><div>קיבולת</div><div>יחידות</div><div>כתובת מדויקת (לניווט)</div></div>
                {halls.map(({ name: hall }) => {
                    const cfg = getCfg(hall);
                    return (
                        <div key={hall} className="hc-row">
                            <div className="hc-name" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="color" value={cfg.color || '#3b82f6'} onChange={(e) => update(hall, { color: e.target.value })}
                                    title="צבע האולם בלוח" style={{ width: 30, height: 30, border: '1px solid var(--bd2)', borderRadius: 8, background: 'transparent', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
                                📍 {hall}
                            </div>
                            <div className="hc-types">
                                <button className={`cc-type ${cfg.type === 'FULL' ? 'on' : ''}`} onClick={() => update(hall, { type: 'FULL' })}>מלא (1)</button>
                                <button className={`cc-type ${cfg.type === 'HALF' ? 'on' : ''}`} onClick={() => update(hall, { type: 'HALF' })}>חצי-חצי (2)</button>
                                <button className={`cc-type ${cfg.type === 'MULTI' ? 'on' : ''}`} onClick={() => update(hall, { type: 'MULTI' })}>רב-יחידות</button>
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
                {halls.length === 0 && <div style={{ color: 'var(--text-dim)', padding: '1rem' }}>אין {Vn} עדיין — הוסף {V1} ראשון למעלה, או פרסם לו"ז כדי לטעון את הרשימה.</div>}
            </div>
        </div>
    );
}
