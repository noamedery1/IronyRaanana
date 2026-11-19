import { useState } from 'react';
import { setNickname } from '../userIdentity.js';

// First-time gate before a parent can mark attendance: the coach needs the player's name, not the
// parent's. Saved forever (server display_name + local). Required — there's no "skip".
export default function PlayerNamePrompt({ team, slug, token, onSaved, onClose }) {
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const save = async () => {
        const v = name.trim();
        if (!v || busy) return;
        setBusy(true);
        try {
            if (token) await fetch(`/api/${slug}/rsvp/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, team, name: v }) });
        } catch { /* offline — keep the local name so the mark still goes through */ }
        setNickname(team, v);
        setBusy(false);
        onSaved(v);
    };
    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,16,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#0f1b31', border: '1px solid #27304a', borderRadius: 16, padding: '1.3rem', width: '100%', maxWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f1f6fc', marginBottom: 6 }}>מה שם המתאמן?</div>
                <div style={{ color: '#9fb0c9', fontSize: '0.82rem', marginBottom: 12 }}>השם שהמאמן יראה ברשימת הנוכחות של {team}. נשמר לפעמים הבאות.</div>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} placeholder="שם המתאמן" style={{ width: '100%', background: '#0a1120', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '0.6rem 0.7rem', color: '#e8edf7', fontSize: '1rem', fontFamily: 'inherit', marginBottom: 14, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={save} disabled={busy || !name.trim()} style={{ flex: 1, background: '#38bdf8', border: 'none', color: '#04233a', borderRadius: 10, padding: '0.6rem', fontWeight: 800, fontSize: '0.95rem', fontFamily: 'inherit', cursor: 'pointer', opacity: (busy || !name.trim()) ? 0.5 : 1 }}>שמור והמשך</button>
                    <button onClick={onClose} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#9fb0c9', borderRadius: 10, padding: '0.6rem 0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>ביטול</button>
                </div>
            </div>
        </div>
    );
}
