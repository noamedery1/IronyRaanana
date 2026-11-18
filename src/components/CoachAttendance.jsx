import { useState, useEffect, useCallback } from 'react';
import { getActiveClub } from '../clubConfig.js';

// Coach attendance tab: for each upcoming training/match of the coach's teams, who's coming, who's
// not, and who hasn't replied (roster minus responders). Data: the live schedule gives the
// occurrences; /rsvp/coach gives the responses + roster. Parents mark on their own board.
const nrm = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
const heDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? `${m[3]}/${m[2]}` : (ymd || ''); };
const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export default function CoachAttendance({ clubSlug, trainer }) {
    const [occs, setOccs] = useState([]);       // [{team,date,start_time,type}]
    const [byTeam, setByTeam] = useState({});    // team -> { roster:[], responses:[] }
    const [loading, setLoading] = useState(true);
    const [notify, setNotify] = useState(!!trainer?.notifyRsvp);
    const [openKey, setOpenKey] = useState('');  // which occurrence shows the "coming" list
    const token = trainer?.token;
    const myTeams = (trainer?.teams || []).map(nrm);

    // B: period report (separate, on demand)
    const ymdOf = (d) => d.toISOString().slice(0, 10);
    const [repOpen, setRepOpen] = useState(false);
    const [rep, setRep] = useState(null);
    const [repBusy, setRepBusy] = useState(false);
    const [rTeam, setRTeam] = useState((trainer?.teams || [])[0] || '');
    const [rFrom, setRFrom] = useState(ymdOf(new Date(Date.now() - 30 * 864e5)));
    const [rTo, setRTo] = useState(ymdOf(new Date()));
    const runReport = async () => {
        if (!rTeam) return;
        setRepBusy(true);
        try {
            const d = await fetch(`/api/${clubSlug}/rsvp/report?team=${encodeURIComponent(rTeam)}&from=${rFrom}&to=${rTo}`, { headers: { 'x-trainer-token': token } })
                .then((r) => r.ok ? r.json() : null).catch(() => null);
            setRep(d);
        } finally { setRepBusy(false); }
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const { sessions = [] } = await fetch(`/api/${clubSlug}/schedule`).then((r) => r.json()).catch(() => ({ sessions: [] }));
            const up = sessions
                .filter((s) => s.team && myTeams.includes(nrm(s.team)) && s.date && s.date >= today && (s.status || 'active') !== 'cancelled')
                .map((s) => ({ team: s.team, date: s.date, start_time: s.start_time || '', type: s.type || 'training' }))
                .sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));
            setOccs(up);
            const teams = [...new Set(up.map((o) => o.team))];
            const results = await Promise.all(teams.map((team) =>
                fetch(`/api/${clubSlug}/rsvp/coach?team=${encodeURIComponent(team)}&from=${today}`, { headers: { 'x-trainer-token': token } })
                    .then((r) => r.ok ? r.json() : { roster: [], responses: [] }).catch(() => ({ roster: [], responses: [] }))
                    .then((d) => [team, d])));
            setByTeam(Object.fromEntries(results));
        } finally { setLoading(false); }
    }, [clubSlug, token]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load(); }, [load]);

    const toggleNotify = async () => {
        const next = !notify; setNotify(next);
        try {
            const r = await fetch(`/api/${clubSlug}/rsvp/coach/notify`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, on: next }),
            });
            if (!r.ok) setNotify(!next);
        } catch { setNotify(!next); }
    };

    // buckets for one occurrence
    const buckets = (o) => {
        const data = byTeam[o.team] || { roster: [], responses: [] };
        const here = data.responses.filter((x) => x.date === o.date && (x.start_time || '') === (o.start_time || ''));
        const inN = here.filter((x) => x.status === 'in').map((x) => x.name);
        const outN = here.filter((x) => x.status === 'out').map((x) => x.name);
        const answered = new Set([...inN, ...outN].map(nrm));
        const noReply = (data.roster || []).filter((n) => !answered.has(nrm(n)));
        return { inN, outN, noReply };
    };

    const dow = (ymd) => { const d = new Date(ymd + 'T00:00:00'); return DAY[d.getDay()]; };

    // Share the lineup to WhatsApp — the coach sends who's coming to the team in one tap. WhatsApp
    // renders *bold*; a divider + club/team header + per-name lines read cleaner than one long list.
    const shareWhatsApp = (o) => {
        const { inN, outN, noReply } = buckets(o);
        const club = getActiveClub()?.name || '';
        const rule = '➖➖➖➖➖➖➖';
        const list = (arr) => arr.map((n) => `•⁠  ⁠${n}`).join('\n');
        const sec = (emoji, label, arr) => arr.length ? `\n\n${emoji} *${label}* (${arr.length})\n${list(arr)}` : '';
        const lines = [
            club ? `*${club}*` : '',
            `*${o.team}* · ${o.type === 'match' ? '⚽ משחק' : 'אימון'}`,
            `📅 ${dow(o.date)} ${heDate(o.date)}${o.start_time ? `  🕐 ${o.start_time}` : ''}`,
            rule,
        ].filter(Boolean).join('\n');
        let text = lines + sec('✅', 'מגיעים', inN) + sec('🚫', 'לא מגיעים', outN) + sec('⏳', 'לא ענו', noReply);
        if (noReply.length) text += `\n\n${rule}\n_מי שטרם עדכן — נא לסמן הגעה באפליקציה 🙏_`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    };
    const chip = (name, bg, color) => <span key={name} style={{ background: bg, color, fontSize: '0.8rem', padding: '0.25rem 0.6rem', borderRadius: 7, margin: '0 0 4px' }}>{name}</span>;

    return (
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginBottom: '0.9rem', flexWrap: 'wrap' }}>
                <div style={{ color: '#cbd5e1', fontSize: '0.86rem', lineHeight: 1.5 }}>ההורים מסמנים הגעה — וכאן אתם רואים מי מגיע לכל אימון/משחק.</div>
                <button onClick={toggleNotify} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '0.5rem 0.75rem', cursor: 'pointer', color: '#cbd5e1', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                    <span>התראת ביטול</span>
                    <span style={{ width: 34, height: 19, background: notify ? '#1d9e75' : 'rgba(255,255,255,0.18)', borderRadius: 999, position: 'relative', transition: 'background .15s' }}>
                        <span style={{ width: 15, height: 15, background: '#fff', borderRadius: '50%', position: 'absolute', top: 2, insetInlineStart: notify ? 2 : 17, transition: 'inset-inline-start .15s' }} />
                    </span>
                </button>
            </div>

            {loading && <div style={{ textAlign: 'center', color: '#94a3b8', padding: '1.5rem' }}>טוען…</div>}
            {!loading && occs.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>אין אימונים או משחקים קרובים בקבוצות שלך. ⚽</div>
            )}

            {!loading && occs.map((o) => {
                const { inN, outN, noReply } = buckets(o);
                const isMatch = o.type === 'match';
                const key = `${o.team}|${o.date}|${o.start_time}`;
                const open = openKey === key;
                return (
                    <div key={key} style={{ background: '#0f1b31', border: '1px solid #27304a', borderInlineStart: `4px solid ${isMatch ? '#f5a524' : '#38bdf8'}`, borderRadius: 14, padding: '0.85rem 0.9rem', marginBottom: '0.7rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
                            <div style={{ color: '#f1f6fc', fontWeight: 800, fontSize: '0.95rem' }}>
                                {isMatch ? '⚽ ' : ''}{o.team} <span style={{ color: '#8aa0c2', fontWeight: 600, fontSize: '0.84rem' }}>· {dow(o.date)} {heDate(o.date)}{o.start_time ? ` · ${o.start_time}` : ''}</span>
                            </div>
                            <button onClick={() => shareWhatsApp(o)} title="שתף הרכב בוואטסאפ" style={{ background: 'rgba(37,211,102,0.14)', border: '1px solid rgba(37,211,102,0.4)', color: '#4ade80', borderRadius: 8, padding: '0.3rem 0.6rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>💬 שתף</button>
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: (outN.length || noReply.length) ? '0.6rem' : 0 }}>
                            <div style={{ flex: 1, textAlign: 'center', background: '#16251b', border: '1px solid #2b5236', borderRadius: 9, padding: '0.35rem' }}><div style={{ color: '#7ddfa0', fontWeight: 800, fontSize: '1.05rem' }}>{inN.length}</div><div style={{ color: '#79a98a', fontSize: '0.72rem' }}>מגיעים</div></div>
                            <div style={{ flex: 1, textAlign: 'center', background: '#2a1718', border: '1px solid #5a2a2c', borderRadius: 9, padding: '0.35rem' }}><div style={{ color: '#f08a8a', fontWeight: 800, fontSize: '1.05rem' }}>{outN.length}</div><div style={{ color: '#c98f90', fontSize: '0.72rem' }}>לא מגיעים</div></div>
                            <div style={{ flex: 1, textAlign: 'center', background: '#1a2133', border: '1px solid #333e57', borderRadius: 9, padding: '0.35rem' }}><div style={{ color: '#aeb9cc', fontWeight: 800, fontSize: '1.05rem' }}>{noReply.length}</div><div style={{ color: '#8792a6', fontSize: '0.72rem' }}>לא ענו</div></div>
                        </div>
                        {outN.length > 0 && (<>
                            <div style={{ color: '#f08a8a', fontSize: '0.76rem', fontWeight: 700, margin: '0.3rem 0 0.3rem' }}>✕ לא מגיעים</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{outN.map((n) => chip(n, '#2a1718', '#f1b6b6'))}</div>
                        </>)}
                        {noReply.length > 0 && (<>
                            <div style={{ color: '#8792a6', fontSize: '0.76rem', fontWeight: 700, margin: '0.5rem 0 0.3rem' }}>⏳ לא ענו</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{noReply.map((n) => chip(n, '#1a2133', '#b9c3d4'))}</div>
                        </>)}
                        {inN.length > 0 && (
                            <div style={{ marginTop: '0.5rem', borderTop: '1px solid #1c2740', paddingTop: '0.5rem' }}>
                                <button onClick={() => setOpenKey(open ? '' : key)} style={{ background: 'none', border: 'none', color: '#6b7c99', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}>{open ? '▾ הסתר' : `▸ הצג ${inN.length} מגיעים`}</button>
                                {open && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: '0.4rem' }}>{inN.map((n) => chip(n, '#16251b', '#9ee6b8'))}</div>}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* B: on-demand period report */}
            <div style={{ marginTop: '1.4rem', borderTop: '1px solid #1c2740', paddingTop: '1rem' }}>
                <button onClick={() => setRepOpen((v) => !v)} style={{ background: 'none', border: 'none', color: '#8aa0c2', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', padding: 0 }}>
                    {repOpen ? '▾' : '▸'} 📊 דוח נוכחות (תקופה)
                </button>
                {repOpen && (
                    <div style={{ marginTop: '0.7rem' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.7rem' }}>
                            <select value={rTeam} onChange={(e) => setRTeam(e.target.value)} style={{ background: '#0a1120', color: '#e8edf7', border: '1px solid #27304a', borderRadius: 8, padding: '0.4rem' }}>
                                {(trainer?.teams || []).map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input type="date" value={rFrom} onChange={(e) => setRFrom(e.target.value)} style={{ background: '#0a1120', color: '#e8edf7', border: '1px solid #27304a', borderRadius: 8, padding: '0.4rem' }} />
                            <input type="date" value={rTo} onChange={(e) => setRTo(e.target.value)} style={{ background: '#0a1120', color: '#e8edf7', border: '1px solid #27304a', borderRadius: 8, padding: '0.4rem' }} />
                            <button onClick={runReport} disabled={repBusy} style={{ background: 'linear-gradient(135deg,#38bdf8,#0284c7)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.45rem 0.9rem', fontWeight: 700, cursor: 'pointer' }}>{repBusy ? '…' : 'הפק דוח'}</button>
                        </div>
                        {rep && (
                            <div style={{ background: '#0f1b31', border: '1px solid #27304a', borderRadius: 12, padding: '0.8rem' }}>
                                <div style={{ color: '#8aa0c2', fontSize: '0.8rem', marginBottom: '0.6rem' }}>{rep.team} · {rep.occurrences} מפגשים בתקופה</div>
                                {rep.players.length === 0 && <div style={{ color: '#6b7c99', fontSize: '0.85rem' }}>אין נתונים.</div>}
                                {rep.players.map((p) => {
                                    const pct = rep.occurrences ? Math.round((p.in / rep.occurrences) * 100) : 0;
                                    return (
                                        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.35rem 0', borderTop: '1px solid #1c2740' }}>
                                            <div style={{ flex: 1, color: '#e8edf7', fontSize: '0.86rem', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                            <div style={{ width: 80, height: 7, background: '#1a2133', borderRadius: 999, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 70 ? '#1d9e75' : pct >= 40 ? '#f5a524' : '#dc2626' }} /></div>
                                            <div style={{ width: 38, textAlign: 'left', color: '#cbd5e1', fontSize: '0.82rem', fontWeight: 700 }}>{pct}%</div>
                                            <div style={{ width: 70, textAlign: 'left', color: '#6b7c99', fontSize: '0.74rem' }}>{p.in}✓ {p.out}✕</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
