import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getIdentity, getMemberships, getOperatorToken, clearIdentity, removeMembership, removeOperator } from '../userIdentity.js';
import { getActiveClub } from '../clubConfig.js';

// "My account" screen — lets a registered user see what they're signed up for and DELETE their
// account + personal data (App Store Guideline 5.1.1(v): account creation requires account deletion).
// Deletion removes the server-side registration, email-list signups and push tokens, then clears the
// device and returns to the welcome screen.
export default function Account() {
    const { club } = useParams();
    const slug = club || getActiveClub().slug;
    const id = getIdentity();
    const memberships = getMemberships();
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);

    // Remove ONE team registration from this device (partial removal), not the whole account. Each team
    // the user picked gets its own remove button with a confirmation — so a parent of two kids can drop
    // one team and keep the other. The server account for that team is deleted via its own token.
    const removeTeam = async (m) => {
        if (!m || !m.team) return;
        if (!window.confirm(`להסיר את ההרשמה לקבוצת "${m.team}"? שאר הקבוצות יישארו.`)) return;
        try {
            if (m.token) {
                await fetch(`/api/${slug}/account/delete`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tokens: [m.token], keepEmail: true }),
                });
            }
        } catch { /* still remove locally */ }
        removeMembership(m.team);
        window.location.reload();
    };

    // The extra roles this device is signed into for THIS club, read from the real session tokens (these
    // live on this origin, so clearing them here is a COMPLETE removal — the matching "back to …" pill
    // disappears and the role must be re-entered to return). This is why removal belongs here, not in the
    // native launcher (a separate origin that can't see or clear these tokens).
    const hasCoach = (() => { try { return Boolean(localStorage.getItem('trainerToken')); } catch { return false; } })();
    const hasManager = (() => { try { return localStorage.getItem('isAdmin') === 'true' && Boolean(localStorage.getItem('mgrToken:' + slug)); } catch { return false; } })();
    const hasOperator = Boolean(getOperatorToken());
    const removeRole = (role) => {
        const label = role === 'coach' ? 'מאמן' : role === 'manager' ? 'מנהל' : 'מפעיל';
        if (!window.confirm(`להתנתק מתפקיד ${label} במכשיר זה? כדי לחזור תצטרכו להזין שוב את הפרטים.`)) return;
        try {
            if (role === 'coach') { localStorage.removeItem('trainerToken'); localStorage.removeItem('trainerInfo'); localStorage.removeItem('trainerPushV2'); }
            else if (role === 'manager') { localStorage.removeItem('mgrToken:' + slug); localStorage.removeItem('isAdmin'); localStorage.removeItem('managerName'); }
            else if (role === 'operator') { removeOperator(); }
        } catch { /* ignore */ }
        window.location.reload();
    };

    const del = async () => {
        setBusy(true);
        const tokens = [...new Set([
            ...memberships.map((m) => m.token).filter(Boolean),
            localStorage.getItem('userToken'),
            getOperatorToken(),
        ].filter(Boolean))];
        try {
            await fetch(`/api/${slug}/account/delete`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tokens }),
            });
        } catch { /* clear locally regardless of network */ }
        try { const m = await import('../push.js'); await m.unsubscribeFromPush(getActiveClub().sheetApi); } catch { /* best effort */ }
        clearIdentity();
        window.location.href = `/${slug}`; // clean welcome
    };

    const wrap = {
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.2rem', direction: 'rtl', fontFamily: 'Rubik, sans-serif',
        background: 'var(--bg, #070b16)', color: 'var(--text, #e8edf7)',
    };
    const card = {
        width: 'min(440px, 94vw)', background: 'var(--ink2, #0f1830)',
        border: '1px solid var(--bd2, rgba(255,255,255,0.12))', borderRadius: 20,
        padding: '1.5rem 1.3rem', boxShadow: '0 30px 80px -20px rgba(0,0,0,.9)',
    };
    const teams = memberships.map((m) => m.team).filter(Boolean);

    return (
        <div style={wrap}>
            <div style={card}>
                <h2 style={{ margin: '0 0 0.2rem', fontSize: '1.3rem' }}>👤 החשבון שלי</h2>
                {id.name && <p style={{ margin: '0 0 0.2rem', color: 'var(--text-dim,#94a3b8)' }}>{id.name}</p>}
                <p style={{ margin: '0 0 1.1rem', color: 'var(--text-dim,#94a3b8)', fontSize: '0.9rem' }}>
                    {id.role === 'operator' ? 'מפעיל' : teams.length ? ('קבוצות: ' + teams.join(', ')) : 'לא מחוברים לקבוצה'}
                </p>

                {/* Per-team removal: drop a single team without deleting the whole account. */}
                {memberships.length > 1 && (
                    <div style={{ border: '1px solid var(--bd2, rgba(255,255,255,0.12))', borderRadius: 14, padding: '0.9rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.95rem' }}>הקבוצות שלי</div>
                        {memberships.map((m) => (
                            <div key={m.team} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', padding: '0.4rem 0', borderTop: '1px solid var(--bd2, rgba(255,255,255,0.08))' }}>
                                <span style={{ fontSize: '0.9rem' }}>{m.team}</span>
                                <button
                                    onClick={() => removeTeam(m)}
                                    style={{ background: 'none', border: '1px solid rgba(239,68,68,0.5)', color: '#fca5a5', borderRadius: 8, padding: '0.3rem 0.7rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', fontFamily: 'inherit' }}
                                >הסר קבוצה</button>
                            </div>
                        ))}
                        <div style={{ marginTop: '0.5rem', color: 'var(--text-dim,#94a3b8)', fontSize: '0.76rem' }}>הסרת קבוצה בודדת לא מוחקת את שאר הקבוצות או את החשבון.</div>
                    </div>
                )}

                {/* Extra roles signed in on this device (coach / manager / operator) — remove = complete logout. */}
                {(hasCoach || hasManager || hasOperator) && (
                    <div style={{ border: '1px solid var(--bd2, rgba(255,255,255,0.12))', borderRadius: 14, padding: '0.9rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '0.95rem' }}>תפקידים נוספים במכשיר</div>
                        {[['manager', 'מנהל', hasManager], ['coach', 'מאמן', hasCoach], ['operator', 'מפעיל', hasOperator]].map(([role, label, on]) => (
                            on ? (
                                <div key={role} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', padding: '0.4rem 0', borderTop: '1px solid var(--bd2, rgba(255,255,255,0.08))' }}>
                                    <span style={{ fontSize: '0.9rem' }}>{label}</span>
                                    <button
                                        onClick={() => removeRole(role)}
                                        style={{ background: 'none', border: '1px solid rgba(239,68,68,0.5)', color: '#fca5a5', borderRadius: 8, padding: '0.3rem 0.7rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', fontFamily: 'inherit' }}
                                    >התנתק</button>
                                </div>
                            ) : null
                        ))}
                        <div style={{ marginTop: '0.5rem', color: 'var(--text-dim,#94a3b8)', fontSize: '0.76rem' }}>ניתוק מסיר את התפקיד מהמכשיר — כדי לחזור צריך להזין שוב את הפרטים.</div>
                    </div>
                )}

                <div style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', borderRadius: 14, padding: '1rem' }}>
                    <div style={{ fontWeight: 800, color: '#fca5a5', marginBottom: '0.4rem' }}>🗑️ מחיקת חשבון ונתונים</div>
                    <p style={{ margin: '0 0 0.8rem', fontSize: '0.84rem', color: 'var(--text-dim,#cbd5e1)', lineHeight: 1.7 }}>
                        פעולה זו תמחק לצמיתות את ההרשמה שלכם, את ההרשמה לעדכוני מייל ואת ההתראות — בכל הקבוצות במכשיר זה. פעולה בלתי הפיכה.
                    </p>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '0.8rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                        אני מבין/ה שהמחיקה סופית
                    </label>
                    <button
                        onClick={del}
                        disabled={!confirm || busy}
                        style={{
                            width: '100%', padding: '0.8rem', borderRadius: 12, border: 'none', fontWeight: 800,
                            cursor: (!confirm || busy) ? 'not-allowed' : 'pointer', opacity: (!confirm || busy) ? 0.55 : 1,
                            background: '#dc2626', color: '#fff',
                        }}
                    >{busy ? 'מוחק…' : 'מחק את החשבון שלי'}</button>
                </div>

                <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                    <Link to={`/${slug}`} style={{ color: 'var(--text-dim,#94a3b8)', fontSize: '0.85rem' }}>חזרה</Link>
                </div>
            </div>
        </div>
    );
}
