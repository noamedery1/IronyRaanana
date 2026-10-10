import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getActiveClub } from '../clubConfig.js';
import { getMemberships, setActiveTeam } from '../userIdentity.js';
import { joinPathForCode } from '../joinRoute.js';

// Join by CODE. A parent types the short 5-digit code their coach/manager gave them instead of
// following an invite link (links are fragile across in-app browsers / iOS PWAs). We resolve the
// code to its club + team and then open that team's normal registration flow — so the code is just
// a friendlier front door to the existing /:club/join/member/:team path.
export default function CodeJoin() {
    const { club } = useParams();
    const navigate = useNavigate();
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        if (e) e.preventDefault();
        const c = code.trim();
        if (!/^\d{5}$/.test(c)) { setError('הקוד הוא 5 ספרות'); return; }
        setLoading(true); setError('');
        try {
            const res = await fetch(`/api/join/${encodeURIComponent(c)}`);
            if (!res.ok) { setError('קוד לא קיים. בדקו שוב עם המאמן או המנהל.'); setLoading(false); return; }
            const d = await res.json();
            // A member already registered to this team → straight to the schedule. Operator/coach codes
            // route to their own flow (operator board / trainer login) via the shared helper.
            const already = d.role !== 'operator' && d.role !== 'coach' && d.role !== 'manager' && getMemberships().some((m) => m.team === d.team);
            if (already) setActiveTeam(d.team);
            const path = already ? `/${d.clubSlug}` : joinPathForCode(d);
            const origin = (d.inviteOrigin || '').replace(/\/$/, '');
            // A subdomain club lives on its own origin — land there with a FULL navigation so identity
            // and PWA state are stored on the right origin and the club always resolves server-side
            // (robust even if this client's club registry is stale → fixes "page not connected to a club").
            if (origin && origin !== window.location.origin) {
                window.location.href = origin + path;
                return;
            }
            navigate(path, { replace: true });
        } catch {
            setError('שגיאת תקשורת, נסו שוב.'); setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.2rem', direction: 'rtl', fontFamily: 'Rubik, sans-serif',
            background: 'var(--bg, #070b16)', color: 'var(--text, #e8edf7)',
        }}>
            <div style={{
                width: 'min(420px, 94vw)', background: 'var(--ink2, #0f1830)',
                border: '1px solid var(--bd2, rgba(255,255,255,0.12))', borderRadius: 20,
                padding: '1.6rem 1.4rem', boxShadow: '0 30px 80px -20px rgba(0,0,0,.9)', textAlign: 'center',
            }}>
                <div style={{ fontSize: '2.4rem', marginBottom: '0.3rem' }}>🔢</div>
                <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.4rem' }}>הצטרפות עם קוד</h2>
                <p style={{ color: 'var(--text-dim, #94a3b8)', fontSize: '0.9rem', margin: '0 0 1.2rem', lineHeight: 1.6 }}>
                    הזינו את הקוד (5 ספרות) שקיבלתם מהמועדון.
                </p>

                <form onSubmit={submit}>
                    <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 5)); setError(''); }}
                        placeholder="12345"
                        autoFocus
                        style={{
                            width: '100%', textAlign: 'center', letterSpacing: '0.5rem', direction: 'ltr',
                            fontSize: '2rem', fontWeight: 800, padding: '0.7rem', borderRadius: 14,
                            border: '1px solid var(--bd2, rgba(255,255,255,0.18))',
                            background: 'var(--glass-2, rgba(255,255,255,0.06))', color: 'var(--text, #e8edf7)', outline: 'none',
                        }}
                    />
                    {error && (
                        <div style={{ marginTop: '0.7rem', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
                    )}
                    <button
                        type="submit"
                        disabled={loading || code.length < 5}
                        style={{
                            width: '100%', marginTop: '1rem', padding: '0.85rem', borderRadius: 12, border: 'none',
                            fontWeight: 800, fontSize: '1rem', cursor: loading || code.length < 5 ? 'not-allowed' : 'pointer',
                            opacity: loading || code.length < 5 ? 0.6 : 1,
                            background: 'linear-gradient(135deg,#34d399,#0d9488)', color: '#06281f',
                        }}
                    >
                        {loading ? 'בודק…' : 'המשך'}
                    </button>
                </form>

                <div style={{ marginTop: '1rem', fontSize: '0.8rem' }}>
                    <Link to={`/${club || getActiveClub().slug}`} style={{ color: 'var(--text-dim, #94a3b8)' }}>
                        חזרה
                    </Link>
                </div>
            </div>
        </div>
    );
}
