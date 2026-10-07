import { getActiveClub } from '../clubConfig.js';
import { getMemberships, getOperatorToken, switchToMember, switchToOperator, clearIdentity } from '../userIdentity.js';

// Floating account control for a REGISTERED non-manager identity (member / operator). It gives two
// things the app was missing:
//   1. an escape hatch — "🚪 יציאה" clears the identity on this device so a user who joined the wrong
//      team (or has a stale one) is never stuck with no way out; they re-enter with a code/link.
//   2. switching — when a device holds more than one identity (parent teams and/or an operator), chips
//      switch between them (fixes the "opened an operator link, parent view gone" case).
// Hidden for managers (they use AdminSwitcher), trainers, and anonymous visitors.
export default function AccountSwitcher() {
    if (typeof window === 'undefined') return null;
    if (localStorage.getItem('isAdmin') === 'true') return null;   // manager → AdminSwitcher
    if (localStorage.getItem('trainerToken')) return null;         // trainer → trainer portal

    const memberships = getMemberships();
    const hasOperator = !!getOperatorToken();
    const role = localStorage.getItem('userRole');
    const activeTeam = localStorage.getItem('userTeam') || '';
    // Only for someone actually signed in (not the anonymous welcome).
    const registered = memberships.length > 0 || hasOperator || role === 'member' || role === 'operator';
    if (!registered) return null;

    const slug = getActiveClub().slug;
    const identities = memberships.length + (hasOperator ? 1 : 0);
    const showSwitch = identities > 1; // only clutter with chips when there's really a choice

    const chip = (active) => ({
        border: 'none', cursor: 'pointer', fontFamily: 'Rubik, sans-serif',
        padding: '0.3rem 0.7rem', borderRadius: 8, fontWeight: 700, fontSize: '0.78rem', whiteSpace: 'nowrap',
        color: active ? '#0b1220' : '#e8edf7',
        background: active ? '#22d3ee' : 'rgba(255,255,255,0.08)',
    });
    // Apply a change then reload /<club> so the view re-derives from the new active identity.
    const go = (fn) => { try { fn(); } catch { /* ignore */ } window.location.href = `/${slug}`; };
    const exit = () => {
        if (window.confirm('לצאת מהחשבון במכשיר זה? כדי להיכנס שוב תצטרכו קוד קבוצה או לינק אישי.')) {
            go(clearIdentity);
        }
    };

    return (
        <div style={{
            position: 'fixed', bottom: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: 1400,
            display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: 'Rubik, sans-serif',
            maxWidth: '94vw', flexWrap: 'wrap', justifyContent: 'center',
            background: 'rgba(10,17,32,0.94)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.16)', borderRadius: '30px', padding: '0.35rem 0.5rem',
            boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)', direction: 'rtl',
        }}>
            <span style={{ color: '#22d3ee', fontWeight: 800, fontSize: '0.72rem', padding: '0 0.3rem' }}>חשבון</span>
            {showSwitch && memberships.map((m) => (
                <button key={m.team} style={chip(role === 'member' && activeTeam === m.team)} onClick={() => go(() => switchToMember(m.team))}>
                    👨‍👩‍👧 {m.team}
                </button>
            ))}
            {showSwitch && hasOperator && (
                <button style={chip(role === 'operator')} onClick={() => go(switchToOperator)}>🛠️ מפעיל</button>
            )}
            <a href={`/${slug}/account`} style={{ ...chip(false), textDecoration: 'none' }}>👤 חשבון</a>
            <button
                onClick={exit}
                style={{ border: 'none', cursor: 'pointer', fontFamily: 'Rubik, sans-serif', padding: '0.3rem 0.7rem', borderRadius: 8, fontWeight: 700, fontSize: '0.78rem', color: '#fecaca', background: 'rgba(239,68,68,0.18)', whiteSpace: 'nowrap' }}
            >🚪 יציאה</button>
        </div>
    );
}
