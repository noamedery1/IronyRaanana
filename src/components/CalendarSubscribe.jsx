import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n.jsx';

// "Auto calendar" subscribe button with a cross-platform chooser:
// Apple (webcal), Google Calendar (add-by-url), and copy-link fallback.
export default function CalendarSubscribe({ teamLabel }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    if (!teamLabel) return null;

    const host = window.location.host;
    const q = encodeURIComponent(teamLabel);
    const httpsUrl = `${window.location.protocol}//${host}/calendar.ics?team=${q}`;
    const webcalUrl = `webcal://${host}/calendar.ics?team=${q}`;
    const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(httpsUrl)}`;

    const apple = () => { window.location.href = webcalUrl; setOpen(false); };
    const google = () => { window.open(googleUrl, '_blank', 'noreferrer'); setOpen(false); };
    const copy = async () => {
        try { await navigator.clipboard.writeText(httpsUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
        catch { window.prompt(t('cal_copy'), httpsUrl); }
    };

    return (
        <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
            <button onClick={() => setOpen(o => !o)} className="action-btn" style={{ background: 'linear-gradient(135deg,#38bdf8,#0284c7)' }} title={t('cal_live_title')}>
                <span>{t('cal_live')}</span><span>📲</span>
            </button>
            {open && (
                <div style={{
                    position: 'absolute', bottom: '115%', insetInlineStart: 0, zIndex: 40,
                    background: 'var(--ink2)', border: '1px solid var(--bd2)', borderRadius: '14px',
                    padding: '0.5rem', minWidth: '210px', boxShadow: '0 18px 44px -16px rgba(0,0,0,.85)',
                    display: 'flex', flexDirection: 'column', gap: '0.35rem'
                }}>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', padding: '0.1rem 0.4rem 0.2rem' }}>{t('cal_choose')}</div>
                    <button onClick={apple} style={item('#e5e7eb')}>🍎 {t('cal_apple')}</button>
                    <button onClick={google} style={item('#34d058')}>📅 {t('cal_google')}</button>
                    <button onClick={copy} style={item('#38bdf8')}>{copied ? t('cal_copied') : `🔗 ${t('cal_copy')}`}</button>
                </div>
            )}
        </span>
    );
}

const item = (accent) => ({
    display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'start',
    background: 'var(--glass-2)', color: 'var(--text)', border: '1px solid var(--glass-border)',
    borderRadius: '10px', padding: '0.6rem 0.7rem', cursor: 'pointer', fontFamily: 'Rubik, sans-serif',
    fontWeight: 700, fontSize: '0.86rem', borderInlineStart: `3px solid ${accent}`, width: '100%'
});
