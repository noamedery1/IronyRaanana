import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n.jsx';

// "Auto calendar" subscribe button + a centered chooser modal (not clipped by the hero card),
// with cross-platform options: Apple (webcal), Android device (.ics), Google Calendar, copy link.
export default function CalendarSubscribe({ teamLabel }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    if (!teamLabel) return null;

    const host = window.location.host;
    const q = encodeURIComponent(teamLabel);
    const httpsUrl = `${window.location.protocol}//${host}/calendar.ics?team=${q}`;
    const webcalUrl = `webcal://${host}/calendar.ics?team=${q}`;

    const apple = () => { window.location.href = webcalUrl; setOpen(false); };
    const android = () => { window.location.href = httpsUrl; setOpen(false); };
    // Google has no reliable one-click subscribe for external feeds → copy the link and open the add-by-URL settings page
    const google = async () => {
        try { await navigator.clipboard.writeText(httpsUrl); } catch { /* ignore */ }
        window.open('https://calendar.google.com/calendar/r/settings/addbyurl', '_blank', 'noreferrer');
        setOpen(false);
    };
    const copy = async () => {
        try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
        catch { window.prompt(t('cal_copy'), httpsUrl); }
    };

    return (
        <>
            <button onClick={() => setOpen(true)} className="action-btn" style={{ background: 'linear-gradient(135deg,#38bdf8,#0284c7)' }} title={t('cal_live_title')}>
                <span>{t('cal_live')}</span><span>📲</span>
            </button>
            {open && createPortal((
                <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--ink2)', border: '1px solid var(--bd2)', borderRadius: '18px', padding: '1.2rem', width: 'min(360px, 92vw)', boxShadow: '0 30px 80px -20px rgba(0,0,0,.9)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
                            <span style={{ fontWeight: 800, fontSize: '1.05rem' }}>📲 {t('cal_choose')}</span>
                            <button onClick={() => setOpen(false)} style={{ background: 'var(--glass-2)', border: '1px solid var(--glass-border)', color: 'var(--text)', width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <button onClick={apple} style={item('#e5e7eb')}>🍎 {t('cal_apple')}</button>
                            <button onClick={android} style={item('#3ddc84')}>🤖 {t('cal_android')}</button>
                            <button onClick={google} style={item('#4285f4')}>📅 {t('cal_google')}</button>
                            <button onClick={copy} style={item('#38bdf8')}>{copied ? t('cal_copied') : `🔗 ${t('cal_copy')}`}</button>
                        </div>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.6, marginTop: '0.8rem' }}>{t('cal_hint')}</p>
                    </div>
                </div>
            ), document.body)}
        </>
    );
}

const item = (accent) => ({
    display: 'flex', alignItems: 'center', gap: '0.6rem', textAlign: 'start',
    background: 'var(--glass-2)', color: 'var(--text)', border: '1px solid var(--glass-border)',
    borderRadius: '12px', padding: '0.85rem 0.9rem', cursor: 'pointer', fontFamily: 'Rubik, sans-serif',
    fontWeight: 700, fontSize: '0.95rem', borderInlineStart: `4px solid ${accent}`, width: '100%'
});
