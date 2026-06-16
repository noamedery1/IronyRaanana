import { useState, useEffect } from 'react';
import { getActiveClub } from '../clubConfig.js';

// Manager messaging hub: send a push to any audience — whole club, all trainers, all
// operators, a specific team's members, or one trainer. DB-backed (server broadcast
// reads push_subscriptions and delivers via web-push).
export default function MessageCenter() {
    const [target, setTarget] = useState('club'); // club|trainers|operators|team|trainer
    const [teams, setTeams] = useState([]);
    const [trainers, setTrainers] = useState([]);
    const [team, setTeam] = useState('');
    const [trainer, setTrainer] = useState('');
    const [body, setBody] = useState('');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const slug = getActiveClub().slug;

    useEffect(() => {
        fetch(`/api/${slug}/teams`).then((r) => r.json())
            .then((d) => { if (d.teams) setTeams(d.teams.map((t) => t.name)); }).catch(() => {});
        fetch(`/api/${slug}/trainers`).then((r) => r.json())
            .then((d) => setTrainers((d.trainers || []).map((t) => t.name))).catch(() => {});
    }, [slug]);

    const segment = () => {
        if (target === 'club') return '';
        if (target === 'trainers') return '__TRAINER';
        if (target === 'operators') return '__OPERATOR__';
        if (target === 'team') return team ? 'team:' + team : null;
        if (target === 'trainer') return trainer ? '__TRAINER__:' + trainer : null;
        return '';
    };

    const send = async () => {
        if (!body.trim()) { setMsg('הקלד הודעה'); return; }
        const seg = segment();
        if (seg === null) { setMsg('בחר קבוצה / מאמן'); return; }
        setBusy(true); setMsg('');
        try {
            const r = await fetch(`/api/${slug}/broadcast`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: 'הודעה מהנהלת המועדון', body, segment: seg }),
            });
            const d = await r.json().catch(() => ({}));
            if (d.error) setMsg('שגיאה: ' + d.error);
            else { setMsg(`✓ נשלח (${d.sent || 0} מכשירים${d.failed ? ', ' + d.failed + ' נכשלו' : ''})`); setBody(''); }
        } catch { setMsg('שגיאת תקשורת'); } finally { setBusy(false); }
    };

    const input = { width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' };
    const radio = (val, label) => (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontWeight: 600 }}>
            <input type="radio" checked={target === val} onChange={() => setTarget(val)} /> {label}
        </label>
    );

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>📢 שליחת הודעות</h3>
            <p style={{ color: '#666', marginTop: 0 }}>ההודעה תופיע כהתראת פוש אצל מי שנרשם והפעיל התראות.</p>

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>למי לשלוח</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.8rem' }}>
                {radio('club', '🏛️ כל המועדון')}
                {radio('trainers', '🏀 כל המאמנים')}
                {radio('operators', '🔑 כל המפעילים')}
                {radio('team', '👥 קבוצה מסוימת')}
                {radio('trainer', '👤 מאמן מסוים')}
            </div>

            {target === 'team' && (
                <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ ...input, marginTop: '0.6rem' }}>
                    <option value="">בחר קבוצה...</option>
                    {teams.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
                </select>
            )}
            {target === 'trainer' && (
                <select value={trainer} onChange={(e) => setTrainer(e.target.value)} style={{ ...input, marginTop: '0.6rem' }}>
                    <option value="">בחר מאמן...</option>
                    {trainers.map((tn) => <option key={tn} value={tn}>{tn}</option>)}
                </select>
            )}

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>תוכן ההודעה</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="לדוגמה: אימון מחר יתקיים כרגיל" style={{ ...input, resize: 'vertical' }} />

            <button onClick={send} disabled={busy} style={{ marginTop: '1rem', background: '#ff7a18', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'שולח...' : '🔔 שלח הודעה'}
            </button>
            {msg && <div style={{ marginTop: '1rem', fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</div>}
        </div>
    );
}
