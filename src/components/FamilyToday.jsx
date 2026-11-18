import { useState, useEffect, useCallback } from 'react';
import NavButton from './NavButton.jsx';

// Unified family view: one agenda across ALL a parent's children/teams, merged and sorted by time,
// each event tagged with its team. Opt-in (classic per-team board stays the default). Occurrences
// come from /schedule (structured sessions); RSVP posts with THAT child's membership token.
const nrm = (s) => (s || '').toString().replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();
const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const heDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? `${m[3]}/${m[2]}` : (ymd || ''); };
const dowOf = (ymd) => { const d = new Date(ymd + 'T00:00:00'); return DAY[d.getDay()]; };

export default function FamilyToday({ clubSlug, memberships }) {
    const [occs, setOccs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [rsvpMap, setRsvpMap] = useState({});
    const [busy, setBusy] = useState('');

    const tokenFor = (team) => (memberships.find((m) => nrm(m.team) === nrm(team)) || {}).token || '';
    const myTeams = memberships.map((m) => nrm(m.team));

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const { sessions = [] } = await fetch(`/api/${clubSlug}/schedule`).then((r) => r.json()).catch(() => ({ sessions: [] }));
            const up = sessions
                .filter((s) => s.team && myTeams.includes(nrm(s.team)) && s.date && s.date >= today && (s.status || 'active') !== 'cancelled')
                .map((s) => ({ team: s.team, date: s.date, start_time: s.start_time || '', type: s.type || 'training', hall: s.hall || '', note: s.note || '' }))
                .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
            setOccs(up);
        } finally { setLoading(false); }
    }, [clubSlug]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { load(); }, [load]);

    const key = (o) => `${o.team}|${o.date}|${o.start_time}`;
    const mark = async (o, status) => {
        const token = tokenFor(o.team);
        if (!token) return;
        setBusy(key(o));
        try {
            const r = await fetch(`/api/${clubSlug}/rsvp`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, team: o.team, date: o.date, start_time: o.start_time, status }),
            });
            if (r.ok) setRsvpMap((m) => ({ ...m, [key(o)]: status }));
        } catch { /* offline */ } finally { setBusy(''); }
    };

    // group by date for day headers
    const byDate = {};
    occs.forEach((o) => { (byDate[o.date] = byDate[o.date] || []).push(o); });
    const dates = Object.keys(byDate).sort();
    const todayYmd = new Date().toISOString().slice(0, 10);

    if (loading) return <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>טוען…</div>;
    if (!occs.length) return <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>אין אירועים קרובים לילדים שלך. ⚽</div>;

    return (
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '0.5rem 1rem 1rem' }}>
            {dates.map((d) => (
                <div key={d} style={{ marginBottom: '1.1rem' }}>
                    <div style={{ color: d === todayYmd ? '#38bdf8' : '#8aa0c2', fontWeight: 800, fontSize: '0.9rem', margin: '0 2px 0.5rem' }}>
                        {d === todayYmd ? 'היום' : dowOf(d)} · {heDate(d)}
                    </div>
                    {byDate[d].map((o) => {
                        const isMatch = o.type === 'match';
                        const st = rsvpMap[key(o)] || '';
                        return (
                            <div key={key(o)} style={{ background: '#0f1b31', border: '1px solid #27304a', borderInlineStart: `4px solid ${isMatch ? '#f5a524' : '#38bdf8'}`, borderRadius: 14, padding: '0.8rem 0.9rem', marginBottom: '0.6rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                                    <div>
                                        <span style={{ background: '#13223c', color: '#7fb3f0', fontSize: '0.74rem', fontWeight: 700, padding: '2px 8px', borderRadius: 7 }}>{o.team}</span>
                                        <span style={{ color: '#f1f6fc', fontWeight: 800, fontSize: '1.05rem', marginInlineStart: 8 }}>{o.start_time || '—'}</span>
                                        <span style={{ color: '#7d8aa3', fontSize: '0.8rem', marginInlineStart: 6 }}>{isMatch ? '⚽ משחק' : 'אימון'}</span>
                                    </div>
                                </div>
                                {(o.hall || o.note) && <div style={{ color: '#8aa0c2', fontSize: '0.82rem', marginBottom: '0.6rem' }}>📍 {o.note ? o.note.replace(/^[⚽🏀🤾🏐🎾🏊🏃🏆]\s*/, '') : o.hall}</div>}
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {o.hall && <NavButton location={o.hall} label="ניווט ‹" navWith="עם" />}
                                    <button onClick={() => mark(o, 'in')} disabled={busy === key(o)} style={{ flex: 1, background: st === 'in' ? '#16a34a' : 'rgba(34,197,94,0.16)', color: st === 'in' ? '#fff' : '#86efac', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 9, padding: '0.5rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>{st === 'in' ? 'מגיע ✓' : '✅ מגיע'}</button>
                                    <button onClick={() => mark(o, 'out')} disabled={busy === key(o)} style={{ flex: 1, background: st === 'out' ? '#dc2626' : 'rgba(239,68,68,0.16)', color: st === 'out' ? '#fff' : '#fca5a5', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 9, padding: '0.5rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>{st === 'out' ? 'לא מגיע ✓' : '🚫 לא מגיע'}</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
