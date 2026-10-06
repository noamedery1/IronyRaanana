import { getActiveClub } from '../clubConfig.js';
import { getMemberships, getOperatorToken, switchToMember, switchToOperator } from '../userIdentity.js';

// Floating identity switcher for a device that holds BOTH a parent (member) identity and an
// operator identity — e.g. a parent connected to their kids' teams who later opened an operator
// link. Opening that link makes the operator view active; without this control the parent board
// vanishes with no way back. Hidden for managers (they use AdminSwitcher), for trainers (own flow),
// and for ordinary single-identity devices — so a normal parent never sees it.
export default function AccountSwitcher() {
    if (typeof window === 'undefined') return null;
    if (localStorage.getItem('isAdmin') === 'true') return null;   // manager → AdminSwitcher
    if (localStorage.getItem('trainerToken')) return null;         // trainer → trainer portal
    const hasMember = getMemberships().length > 0;
    const hasOperator = !!getOperatorToken();
    if (!(hasMember && hasOperator)) return null;                  // only when BOTH identities exist

    const slug = getActiveClub().slug;
    const role = localStorage.getItem('userRole');

    const chip = (active) => ({
        border: 'none', cursor: 'pointer', fontFamily: 'Rubik, sans-serif',
        padding: '0.3rem 0.7rem', borderRadius: 8, fontWeight: 700, fontSize: '0.78rem',
        color: active ? '#0b1220' : '#e8edf7',
        background: active ? '#22d3ee' : 'rgba(255,255,255,0.08)',
    });
    // Apply the switch, then reload /<club> so the view re-derives from the new active identity.
    const go = (fn) => { try { fn(); } catch { /* ignore */ } window.location.href = `/${slug}`; };

    return (
        <div style={{
            position: 'fixed', bottom: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: 1400,
            display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: 'Rubik, sans-serif',
            background: 'rgba(10,17,32,0.94)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.16)', borderRadius: '30px', padding: '0.35rem 0.5rem',
            boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)', direction: 'rtl',
        }}>
            <span style={{ color: '#22d3ee', fontWeight: 800, fontSize: '0.72rem', padding: '0 0.3rem' }}>חשבון</span>
            <button style={chip(role === 'member')} onClick={() => go(() => switchToMember())}>👨‍👩‍👧 הורה</button>
            <button style={chip(role === 'operator')} onClick={() => go(switchToOperator)}>🛠️ מפעיל</button>
        </div>
    );
}
