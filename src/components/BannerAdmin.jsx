import { useEffect, useState, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

// Manage the public ticker banners in one screen:
//  - General banner (floatingMessage): shown to everyone.
//  - Per-team banners (teamBanners): shown only to that team's members (a multi-team parent
//    sees each of their teams' banners in turn).
// Team list is searchable and collapsible so it stays manageable with many teams.
export default function BannerAdmin({ clubSlug }) {
    const [genEnabled, setGenEnabled] = useState(false);
    const [genText, setGenText] = useState('');
    const [teams, setTeams] = useState([]);
    const [teamBanners, setTeamBanners] = useState({}); // name -> { enabled, text }
    const [expanded, setExpanded] = useState(() => new Set()); // which team rows are open
    const [search, setSearch] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/settings/floatingMessage`).then((r) => r.json())
            .then((d) => { const v = d.value || {}; setGenEnabled(!!v.enabled); setGenText(v.text || ''); }).catch(() => {});
        fetch(`/api/${clubSlug}/settings/teamBanners`).then((r) => r.json())
            .then((d) => {
                const tb = d.value && typeof d.value === 'object' ? d.value : {};
                setTeamBanners(tb);
                // Auto-open rows that already have a message, so existing banners are visible at a glance.
                setExpanded(new Set(Object.keys(tb).filter((n) => (tb[n]?.text || '').trim())));
            }).catch(() => {});
        fetch(`/api/${clubSlug}/teams`).then((r) => r.json())
            .then((d) => setTeams((d.teams || []).map((t) => t.name))).catch(() => {});
    }, [clubSlug]);

    useEffect(() => { load(); }, [load]);

    const setTB = (name, patch) => setTeamBanners((m) => ({ ...m, [name]: { enabled: false, text: '', ...(m[name] || {}), ...patch } }));
    const toggleOpen = (name) => setExpanded((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });

    const save = async () => {
        setBusy(true); setMsg('');
        try {
            const h = { 'Content-Type': 'application/json', ...authHeaders(clubSlug) };
            const r1 = await fetch(`/api/${clubSlug}/settings/floatingMessage`, {
                method: 'PUT', headers: h, body: JSON.stringify({ value: { enabled: genEnabled, text: genText } }),
            });
            const clean = {};
            Object.entries(teamBanners).forEach(([name, v]) => { if (v && (v.text || '').trim()) clean[name] = { enabled: !!v.enabled, text: v.text }; });
            const r2 = await fetch(`/api/${clubSlug}/settings/teamBanners`, {
                method: 'PUT', headers: h, body: JSON.stringify({ value: clean }),
            });
            if (r1.status === 401 || r2.status === 401) setMsg('מצב תצוגה בלבד — היכנס עם חשבון מנהל כדי לשמור.');
            else setMsg(r1.ok && r2.ok ? '✓ נשמר ופורסם' : '❌ נכשל');
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    const areaStyle = { width: '100%' };
    const q = search.trim().toLowerCase();
    const filtered = teams.filter((n) => !q || n.toLowerCase().includes(q));
    const activeCount = Object.values(teamBanners).filter((v) => v && v.enabled && (v.text || '').trim()).length;

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <div className="cc-title" style={{ fontSize: '1rem' }}>👥 באנרים לפי קבוצה {activeCount ? <span style={{ color: '#10b981', fontSize: '0.85rem' }}>· {activeCount} פעילים</span> : null}</div>
                {teams.length > 4 && (
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 חיפוש קבוצה…"
                        style={{ padding: '0.5rem 0.8rem', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--glass-2)', color: 'var(--text)', minWidth: 180 }} />
                )}
            </div>
            {teams.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.88rem' }}>אין קבוצות עדיין — פרסם לו"ז תחילה.</div>}

            {/* Own scroll area so a long team list stays contained and scrollable (not one endless page). */}
            <div style={{ maxHeight: '48vh', overflowY: 'auto', display: 'grid', gap: '0.5rem', paddingInlineEnd: 4 }}>
                {filtered.map((name) => {
                    const v = teamBanners[name] || { enabled: false, text: '' };
                    const open = expanded.has(name);
                    const preview = (v.text || '').split('\n')[0];
                    return (
                        <div key={name} style={{ border: '1px solid var(--glass-border)', borderRadius: 10, background: v.enabled ? 'rgba(16,185,129,0.06)' : 'transparent' }}>
                            <div onClick={() => toggleOpen(name)} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.8rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={!!v.enabled}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => { setTB(name, { enabled: e.target.checked }); }}
                                    style={{ width: 18, height: 18 }} />
                                <span style={{ fontWeight: 700 }}>{name}</span>
                                <span style={{ fontSize: '0.7rem' }}>{v.enabled ? '🟢' : '⚪'}</span>
                                {!open && preview && <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>— {preview}</span>}
                                <span style={{ marginInlineStart: 'auto', color: 'var(--text-dim)' }}>{open ? '▲' : '▾'}</span>
                            </div>
                            {open && (
                                <div style={{ padding: '0 0.8rem 0.8rem' }}>
                                    <textarea value={v.text || ''} onChange={(e) => setTB(name, { text: e.target.value })} rows={2}
                                        placeholder={`הודעה שתופיע רק לחברי ${name}`} className="cm-textarea" style={areaStyle} />
                                </div>
                            )}
                        </div>
                    );
                })}
                {teams.length > 0 && filtered.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', padding: '0.5rem' }}>לא נמצאה קבוצה תואמת.</div>}
            </div>
        </div>
    );
}
