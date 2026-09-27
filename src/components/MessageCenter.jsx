import { useState, useEffect } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';

// Manager messaging hub: send a push to any audience — whole club, all trainers, all
// operators, OR a multi-selection of specific teams / specific trainers. DB-backed.
export default function MessageCenter() {
    const [target, setTarget] = useState('club'); // club|trainers|operators|team|trainer
    const [teams, setTeams] = useState([]);
    const [trainers, setTrainers] = useState([]);
    const [selTeams, setSelTeams] = useState({});      // name -> bool (multi)
    const [selTrainers, setSelTrainers] = useState({}); // name -> bool (multi)
    const [body, setBody] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const [stats, setStats] = useState({ total: 0, bySegment: {} }); // subscriber counts per segment

    const slug = getActiveClub().slug;

    const loadStats = () => fetch(`/api/${slug}/push-stats`, { headers: authHeaders(slug) })
        .then((r) => r.json()).then((d) => { if (d && d.bySegment) setStats(d); }).catch(() => {});

    useEffect(() => {
        fetch(`/api/${slug}/teams`).then((r) => r.json())
            .then((d) => { if (d.teams) setTeams(d.teams.map((t) => t.name)); }).catch(() => {});
        fetch(`/api/${slug}/trainers`).then((r) => r.json())
            .then((d) => setTrainers((d.trainers || []).map((t) => t.name))).catch(() => {});
        loadStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);

    // How many devices are subscribed for a given target. A team also counts legacy label-format
    // rows ("<name> - <coach>" / bare "<name>"), matching how broadcast delivers.
    const seg = stats.bySegment || {};
    // A device can subscribe to several teams (one "team:<name>" per line), so count a team by
    // whole-line membership, plus the legacy bare/label formats.
    const teamCount = (name) => Object.keys(seg).reduce((a, k) => {
        const hit = k.split('\n').includes('team:' + name) || k === name || k.startsWith(name + ' - ');
        return a + (hit ? seg[k] : 0);
    }, 0);
    const trainerCount = (name) => seg['__TRAINER__:' + name] || 0;
    const trainersTotal = Object.keys(seg).filter((k) => k.startsWith('__TRAINER')).reduce((a, k) => a + seg[k], 0);
    const operatorsTotal = seg['__OPERATOR__'] || 0;
    const badge = (n) => <span style={{ color: n > 0 ? '#059669' : '#b91c1c', fontWeight: 700, fontSize: '0.8rem' }}>👥 {n}</span>;

    const chosen = (map) => Object.keys(map).filter((k) => map[k]);

    // Returns the list of push segments to send to (one broadcast per segment).
    const segments = () => {
        if (target === 'club') return [''];
        if (target === 'trainers') return ['__TRAINER'];
        if (target === 'operators') return ['__OPERATOR__'];
        if (target === 'team') return chosen(selTeams).map((t) => 'team:' + t);
        if (target === 'trainer') return chosen(selTrainers).map((t) => '__TRAINER__:' + t);
        return [];
    };

    // Human-readable description of the audience — stored in the archive so the manager can
    // see later who a message went to.
    const targetLabel = () => {
        if (target === 'club') return 'כל המועדון';
        if (target === 'trainers') return 'כל המאמנים';
        if (target === 'operators') return 'כל המפעילים';
        if (target === 'team') return 'קבוצות: ' + chosen(selTeams).join(', ');
        if (target === 'trainer') return 'מאמנים: ' + chosen(selTrainers).join(', ');
        return '';
    };

    const send = async () => {
        if (!body.trim()) { setMsg('הקלד הודעה'); return; }
        const segs = segments();
        if (segs.length === 0) { setMsg('בחר לפחות קבוצה / מאמן אחד'); return; }
        setBusy(true); setMsg('');
        try {
            // One call: the server sends to every segment AND archives the message (for resend).
            const r = await fetch(`/api/${slug}/messages`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
                body: JSON.stringify({ title: 'הודעה מהנהלת המועדון', body, target: targetLabel(), segments: segs }),
            });
            const d = await r.json().catch(() => ({ error: 'x' }));
            if (d.error) { setMsg('⚠️ שגיאה בשליחה'); return; }
            const codes = d.statusCodes || {};
            const codeStr = Object.keys(codes).length ? ` [${Object.entries(codes).map(([k, v]) => `${k}×${v}`).join(', ')}]` : '';
            setMsg(`✓ נשלח (${d.sent || 0} מכשירים${d.failed ? `, ${d.failed} נכשלו${codeStr}` : ''})`);
            setBody('');
            loadStats(); // refresh counts (a send prunes expired subscriptions)
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    const input = { width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' };
    const radio = (val, label, count) => (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontWeight: 600 }}>
            <input type="radio" checked={target === val} onChange={() => setTarget(val)} /> {label}
            {count !== undefined && <span style={{ marginInlineStart: 'auto' }}>{badge(count)}</span>}
        </label>
    );

    // Multi-select checkbox grid with select-all / clear. `countFn` shows subscribers per item.
    const picker = (items, map, setMap, emptyLabel, countFn) => (
        <div style={{ marginTop: '0.6rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <button type="button" onClick={() => setMap(Object.fromEntries(items.map((i) => [i, true])))}
                    style={{ ...chipBtn }}>בחר הכל</button>
                <button type="button" onClick={() => setMap({})} style={{ ...chipBtn }}>נקה</button>
                <span style={{ color: '#64748b', fontSize: '0.85rem', alignSelf: 'center' }}>נבחרו {chosen(map).length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.3rem', maxHeight: 200, overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.6rem' }}>
                {items.length === 0 && <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{emptyLabel}</span>}
                {items.map((name) => (
                    <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input type="checkbox" checked={!!map[name]} onChange={() => setMap((m) => ({ ...m, [name]: !m[name] }))} />
                        <span style={{ flex: 1 }}>{name}</span>
                        {countFn && badge(countFn(name))}
                    </label>
                ))}
            </div>
        </div>
    );

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>📢 שליחת הודעות</h3>
            <p style={{ color: '#666', marginTop: 0 }}>ההודעה תופיע כהתראת פוש אצל מי שנרשם והפעיל התראות.</p>

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>למי לשלוח</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.8rem' }}>
                {radio('club', '🏛️ כל המועדון', stats.total)}
                {radio('trainers', '🏀 כל המאמנים', trainersTotal)}
                {radio('operators', '🔑 כל המפעילים', operatorsTotal)}
                {radio('team', '👥 קבוצות (בחירה מרובה)')}
                {radio('trainer', '👤 מאמנים (בחירה מרובה)')}
            </div>
            <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '0.4rem 0 0' }}>
                👥 = כמה מכשירים הפעילו התראות ויקבלו את ההודעה. 0 = אף אחד עדיין לא הפעיל התראות ליעד הזה.
            </p>

            {target === 'team' && picker(teams, selTeams, setSelTeams, 'אין קבוצות — פרסם לו"ז תחילה', teamCount)}
            {target === 'trainer' && picker(trainers, selTrainers, setSelTrainers, 'אין מאמנים', trainerCount)}

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>תוכן ההודעה</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="לדוגמה: אימון מחר יתקיים כרגיל" style={{ ...input, resize: 'vertical' }} />

            <button onClick={send} disabled={busy} style={{ marginTop: '1rem', background: '#ff7a18', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'שולח...' : '🔔 שלח הודעה'}
            </button>
            {msg && <div style={{ marginTop: '1rem', fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</div>}
        </div>
    );
}

const chipBtn = { background: '#eef2f7', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.3rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 };
