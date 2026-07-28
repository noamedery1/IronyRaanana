import { getActiveClub } from '../clubConfig.js';
import { sportEmoji } from '../sportLabels.js';

// Floating mode switcher — MANAGER ONLY. It's a preview tool for the person running the
// club (jump between הורים / מאמן / ניהול). Parents and trainers never see it: parents get
// a clean app, and trainers reach the parent board via the "לוח מלא" link in their header.
export default function AdminSwitcher() {
    if (typeof window === 'undefined') return null;
    const isManager = localStorage.getItem('isAdmin') === 'true';
    if (!isManager) return null; // only the manager gets the switcher

    const slug = getActiveClub().slug;
    const here = window.location.pathname;
    const link = (active) => ({
        textDecoration: 'none', padding: '0.3rem 0.6rem', borderRadius: 8, fontWeight: 700,
        fontSize: '0.78rem', color: active ? '#0b1220' : '#e8edf7',
        background: active ? '#22d3ee' : 'rgba(255,255,255,0.08)',
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
            <span style={{ color: '#22d3ee', fontWeight: 800, fontSize: '0.72rem', padding: '0 0.3rem' }}>תצוגה</span>
            <a href={`/${slug}?view=parent`} style={link(onParent)}>👨‍👩‍👧 הורים</a>
            <a href={`/${slug}/trainer`} style={link(onTrainer)}>{sportEmoji()} מאמן</a>
            <a href={`/${slug}/admin/dashboard`} style={link(onAdmin)}>🗂️ ניהול</a>
        </div>
    );
}
