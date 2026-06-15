import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { getActiveClub } from '../clubConfig.js';

// Manager messaging hub: send a push to any audience — whole club, all trainers, all
// operators, a specific team's members, or one trainer. Goes through the live Apps
// Script (sendBroadcast), which holds the push subscriptions + secret.
export default function MessageCenter({ liveApi }) {
    const [target, setTarget] = useState('club'); // club|trainers|operators|team|trainer
    const [teams, setTeams] = useState([]);
    const [trainers, setTrainers] = useState([]);
    const [team, setTeam] = useState('');
    const [trainer, setTrainer] = useState('');
    const [body, setBody] = useState('');
    const [pw, setPw] = useState(() => localStorage.getItem('managerPushPw') || '');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        // Teams from the public board.
        Papa.parse(getActiveClub().dataUrl, {
            download: true,
            complete: (res) => {
                const rows = res.data;
                let h = -1;
                for (let i = 0; i < rows.length; i++) if (rows[i][0] && rows[i][0].includes('קבוצות')) { h = i; break; }
                if (h === -1) return;
                const set = new Set();
                rows.slice(h + 1).forEach((r) => { const n = (r[0] || '').toString().trim(); if (n && !n.toLowerCase().includes('xxx')) set.add(n); });
                setTeams([...set]);
            },
        });
        // Trainers from the live script.
        fetch(liveApi, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'getTrainers' }) })
            .then((r) => r.json()).then((d) => setTrainers(d.trainers || [])).catch(() => {});
    }, [liveApi]);

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
        setBusy(true); setMsg(''); localStorage.setItem('managerPushPw', pw);
        try {
            const r = await fetch(liveApi, {
                method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'sendBroadcast', password: pw, title: 'הודעה מהנהלת המועדון', body, segment: seg }),
            });
            const d = await r.json().catch(() => ({}));
            if (d.error) setMsg('שגיאה: ' + d.error);
            else { setMsg('✓ ההודעה נשלחה'); setBody(''); }
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

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>סיסמת מנהל (אם הוגדרה בשרת)</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="השאר ריק אם לא הוגדרה" style={input} />

            <button onClick={send} disabled={busy} style={{ marginTop: '1rem', background: '#ff7a18', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'שולח...' : '🔔 שלח הודעה'}
            </button>
            {msg && <div style={{ marginTop: '1rem', fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</div>}
        </div>
    );
}
