import { useEffect, useState, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

// Manage the public ticker banners in one screen:
//  - General banner (floatingMessage): shown to everyone.
//  - Per-team banners (teamBanners): shown only to that team's members (a multi-team parent
//    sees each of their teams' banners in turn).
export default function BannerAdmin({ clubSlug }) {
    const [genEnabled, setGenEnabled] = useState(false);
    const [genText, setGenText] = useState('');
    const [teams, setTeams] = useState([]);
    const [teamBanners, setTeamBanners] = useState({}); // name -> { enabled, text }
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/settings/floatingMessage`).then((r) => r.json())
            .then((d) => { const v = d.value || {}; setGenEnabled(!!v.enabled); setGenText(v.text || ''); }).catch(() => {});
        fetch(`/api/${clubSlug}/settings/teamBanners`).then((r) => r.json())
            .then((d) => setTeamBanners(d.value && typeof d.value === 'object' ? d.value : {})).catch(() => {});
        fetch(`/api/${clubSlug}/teams`).then((r) => r.json())
            .then((d) => setTeams((d.teams || []).map((t) => t.name))).catch(() => {});
    }, [clubSlug]);

    useEffect(() => { load(); }, [load]);

    const setTB = (name, patch) => setTeamBanners((m) => ({ ...m, [name]: { enabled: false, text: '', ...(m[name] || {}), ...patch } }));

    const save = async () => {
        setBusy(true); setMsg('');
        try {
            const h = { 'Content-Type': 'application/json', ...authHeaders(clubSlug) };
            const r1 = await fetch(`/api/${clubSlug}/settings/floatingMessage`, {
                method: 'PUT', headers: h, body: JSON.stringify({ value: { enabled: genEnabled, text: genText } }),
            });
            // Keep only teams that actually have text, so the store stays tidy.
            const clean = {};
            Object.entries(teamBanners).forEach(([name, v]) => { if (v && (v.text || '').trim()) clean[name] = { enabled: !!v.enabled, text: v.text }; });
            const r2 = await fetch(`/api/${clubSlug}/settings/teamBanners`, {
                method: 'PUT', headers: h, body: JSON.stringify({ value: clean }),
            });
            setMsg(r1.ok && r2.ok ? '✓ נשמר ופורסם' : '❌ נכשל');
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    const areaStyle = { width: '100%', maxWidth: 720 };

    return (
        <div className="cc">
            <div className="cc-toolbar">
                <div className="cc-title">📣 באנרים</div>
                <button className="cc-btn green" onClick={save} disabled={busy}>{busy ? 'שומר…' : '💾 שמור ופרסם'}</button>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                באנר נע בראש האתר. הבאנר הכללי מוצג לכולם; באנר של קבוצה מוצג רק לחברי אותה קבוצה
                (הורה בכמה קבוצות יראה את כולם ברצף). כל שורה = הודעה נפרדת.
                {msg && <b style={{ marginInlineStart: '0.6rem', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</b>}
            </p>

            {/* General banner */}
            <div style={{ border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem', marginBottom: '1.2rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.7rem', cursor: 'pointer', fontWeight: 700 }}>
                    <input type="checkbox" checked={genEnabled} onChange={(e) => setGenEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
                    🏛️ באנר כללי (כל המועדון) {genEnabled ? '🟢' : '⚪'}
                </label>
                <textarea value={genText} onChange={(e) => setGenText(e.target.value)} rows={3}
                    placeholder={"כל שורה היא הודעה נפרדת. לדוגמה:\nמשחק בית מול הפועל ת״א — שבת 19:00"}
                    className="cm-textarea" style={areaStyle} />
            </div>

            {/* Per-team banners */}
            <div className="cc-title" style={{ fontSize: '1rem', marginBottom: '0.6rem' }}>👥 באנרים לפי קבוצה</div>
            {teams.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.88rem' }}>אין קבוצות עדיין — פרסם לו"ז תחילה.</div>}
            <div style={{ display: 'grid', gap: '0.8rem' }}>
                {teams.map((name) => {
                    const v = teamBanners[name] || { enabled: false, text: '' };
                    return (
                        <div key={name} style={{ border: '1px solid var(--glass-border)', borderRadius: 12, padding: '0.9rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem', cursor: 'pointer', fontWeight: 700 }}>
                                <input type="checkbox" checked={!!v.enabled} onChange={(e) => setTB(name, { enabled: e.target.checked })} style={{ width: 18, height: 18 }} />
                                {name} {v.enabled ? '🟢' : '⚪'}
                            </label>
                            <textarea value={v.text || ''} onChange={(e) => setTB(name, { text: e.target.value })} rows={2}
                                placeholder={`הודעה שתופיע רק לחברי ${name}`} className="cm-textarea" style={areaStyle} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
