import { useState, useEffect } from 'react';

// Manager → trainers push broadcast. Reads the trainer list and sends a free-text push
// to all trainers or a selected subset, via the LIVE Apps Script (which holds the push
// subscriptions + secret). Trainers are registered per-name under "__TRAINER__:<name>".
export default function TrainerBroadcast({ liveApi }) {
    const [trainers, setTrainers] = useState([]);
    const [selected, setSelected] = useState({});
    const [sendAll, setSendAll] = useState(true);
    const [body, setBody] = useState('');
    const [pw, setPw] = useState(() => localStorage.getItem('managerPushPw') || '');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetch(liveApi, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'getTrainers' }),
        })
            .then((r) => r.json())
            .then((d) => setTrainers(d.trainers || []))
            .catch(() => {});
    }, [liveApi]);

    const toggle = (name) => setSelected((s) => ({ ...s, [name]: !s[name] }));

    const send = async () => {
        if (!body.trim()) { setMsg('הקלד הודעה לשליחה'); return; }
        const targets = sendAll ? 'all' : Object.keys(selected).filter((n) => selected[n]);
        if (targets !== 'all' && targets.length === 0) { setMsg('בחר לפחות מאמן אחד'); return; }
        setBusy(true);
        setMsg('');
        localStorage.setItem('managerPushPw', pw);
        try {
            const r = await fetch(liveApi, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'sendTrainerPush', password: pw, title: 'הודעה מהנהלת המועדון', body, targets }),
            });
            const d = await r.json().catch(() => ({}));
            if (d.error) setMsg('שגיאה: ' + d.error);
            else { setMsg('✓ ההודעה נשלחה למאמנים'); setBody(''); }
        } catch {
            setMsg('שגיאת תקשורת, נסה שוב');
        } finally {
            setBusy(false);
        }
    };

    const input = { width: '100%', padding: '0.7rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontFamily: 'inherit' };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>📨 שליחת הודעת פוש למאמנים</h3>
            <p style={{ color: '#666', marginTop: 0 }}>ההודעה תופיע כהתראה בטלפון של המאמנים שנרשמו (נכנסו לפורטל המאמנים והפעילו התראות).</p>

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>תוכן ההודעה</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="לדוגמה: תזכורת — ישיבת מאמנים מחר ב-19:00" style={{ ...input, resize: 'vertical' }} />

            <div style={{ margin: '1rem 0 0.5rem', display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="radio" checked={sendAll} onChange={() => setSendAll(true)} /> כל המאמנים
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="radio" checked={!sendAll} onChange={() => setSendAll(false)} /> מאמנים נבחרים
                </label>
            </div>

            {!sendAll && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.4rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.8rem', maxHeight: 220, overflowY: 'auto' }}>
                    {trainers.length === 0 && <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>טוען רשימת מאמנים...</div>}
                    {trainers.map((name) => (
                        <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                            <input type="checkbox" checked={!!selected[name]} onChange={() => toggle(name)} /> {name}
                        </label>
                    ))}
                </div>
            )}

            <label style={{ display: 'block', margin: '1rem 0 0.4rem', fontWeight: 600 }}>סיסמת מנהל (אם הוגדרה בשרת)</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="השאר ריק אם לא הוגדרה" style={input} />

            <button onClick={send} disabled={busy} style={{ marginTop: '1rem', background: '#ff7a18', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer' }}>
                {busy ? 'שולח...' : '🔔 שלח הודעה'}
            </button>
            {msg && <div style={{ marginTop: '1rem', fontWeight: 'bold', color: msg.startsWith('✓') ? '#10b981' : '#ef4444' }}>{msg}</div>}
        </div>
    );
}
