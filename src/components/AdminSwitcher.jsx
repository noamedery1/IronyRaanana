import { getActiveClub } from '../clubConfig.js';

// Floating mode switcher shown ONLY to the manager (after admin login). Lets the manager
// jump between parent view, trainer portal, and the admin dashboard from any screen —
// handy for testing and demoing the product. Invisible to parents and trainers.
export default function AdminSwitcher() {
    if (typeof window === 'undefined') return null;
    if (localStorage.getItem('isAdmin') !== 'true') return null;

    const slug = getActiveClub().slug;
    const here = window.location.pathname;
    const link = (active) => ({
        textDecoration: 'none', padding: '0.3rem 0.6rem', borderRadius: 8, fontWeight: 700,
        fontSize: '0.78rem', color: active ? '#0b1220' : '#e8edf7',
        background: active ? '#ff9d3c' : 'rgba(255,255,255,0.08)',
    });

    const isParent = here === `/${slug}` || here === '/' || here === `/${slug}/women`;
    const isTrainer = here.indexOf('/trainer') >= 0;
    const isAdmin = here.indexOf('/admin') >= 0;

    return (
        <div style={{
            position: 'fixed', bottom: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: 1400,
            display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: 'Rubik, sans-serif',
            background: 'rgba(10,17,32,0.94)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.16)', borderRadius: '30px', padding: '0.35rem 0.5rem',
            boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)', direction: 'rtl',
        }}>
            <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: '0.72rem', padding: '0 0.3rem' }}>מנהל</span>
            <a href={`/${slug}`} style={link(isParent)}>👨‍👩‍👧 הורים</a>
            <a href={`/${slug}/trainer`} style={link(isTrainer)}>🏀 מאמן</a>
            <a href="/admin/dashboard" style={link(isAdmin)}>🗂️ ניהול</a>
        </div>
    );
}
