import { getActiveClub } from '../clubConfig.js';

// Role-based floating mode switcher:
// - Manager (admin login)  → הורים / מאמן / ניהול
// - Trainer (logged in)     → הורים / מאמן
// - Parent (no login)       → nothing (hidden)
export default function AdminSwitcher() {
    if (typeof window === 'undefined') return null;
    const isManager = localStorage.getItem('isAdmin') === 'true';
    const isTrainer = !!localStorage.getItem('trainerToken');
    if (!isManager && !isTrainer) return null; // parents see no switcher

    const slug = getActiveClub().slug;
    const here = window.location.pathname;
    const link = (active) => ({
        textDecoration: 'none', padding: '0.3rem 0.6rem', borderRadius: 8, fontWeight: 700,
        fontSize: '0.78rem', color: active ? '#0b1220' : '#e8edf7',
        background: active ? '#ff9d3c' : 'rgba(255,255,255,0.08)',
    });

    const onParent = here === `/${slug}` || here === '/' || here === `/${slug}/women`;
    const onTrainer = here.indexOf('/trainer') >= 0;
    const onAdmin = here.indexOf('/admin') >= 0;

    return (
        <div style={{
            position: 'fixed', bottom: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: 1400,
            display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: 'Rubik, sans-serif',
            background: 'rgba(10,17,32,0.94)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.16)', borderRadius: '30px', padding: '0.35rem 0.5rem',
            boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)', direction: 'rtl',
        }}>
            <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: '0.72rem', padding: '0 0.3rem' }}>{isManager ? 'מנהל' : 'מאמן'}</span>
            <a href={`/${slug}`} style={link(onParent)}>👨‍👩‍👧 הורים</a>
            <a href={`/${slug}/trainer`} style={link(onTrainer)}>🏀 מאמן</a>
            {isManager && <a href="/admin/dashboard" style={link(onAdmin)}>🗂️ ניהול</a>}
        </div>
    );
}
