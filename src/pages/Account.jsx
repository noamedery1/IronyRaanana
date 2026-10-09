import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getIdentity, getMemberships, getOperatorToken, clearIdentity } from '../userIdentity.js';
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
