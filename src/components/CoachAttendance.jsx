import { useState, useEffect, useCallback } from 'react';

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

    // Share the lineup to WhatsApp — the coach sends who's coming to the team in one tap.
    const shareWhatsApp = (o) => {
        const { inN, outN, noReply } = buckets(o);
        const head = `${o.type === 'match' ? '⚽ משחק' : 'אימון'} · ${o.team} · ${dow(o.date)} ${heDate(o.date)}${o.start_time ? ' ' + o.start_time : ''}`;
        const sec = (emoji, label, arr) => arr.length ? `\n\n${emoji} ${label} (${arr.length}):\n${arr.join(', ')}` : '';
        const text = head + sec('✅', 'מגיעים', inN) + sec('🚫', 'לא מגיעים', outN) + sec('⏳', 'לא ענו', noReply);
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
        </div>
    );
}
