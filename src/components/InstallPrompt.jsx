import { useState, useEffect } from 'react';
import { useI18n } from '../i18n.jsx';

// Smart "install app" banner:
// - Android/desktop Chrome: captures beforeinstallprompt and offers a one-tap install.
// - iOS Safari (no beforeinstallprompt): shows "Share → Add to Home Screen" instructions.
// Hidden when already installed (standalone) or after the user dismisses it.
export default function InstallPrompt() {
    const { t } = useI18n();
    const [deferred, setDeferred] = useState(null);
    const [mode, setMode] = useState(null); // 'android' | 'ios'
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        if (standalone) return;
        if (localStorage.getItem('pwaPromptDismissed') === '1') return;

        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

        const onBip = (e) => {
            e.preventDefault();
            setDeferred(e);
            setMode('android');
            setVisible(true);
        };
        window.addEventListener('beforeinstallprompt', onBip);

        let iosTimer;
        if (isIOS) {
            // iOS gives no event — show instructions shortly after load
            iosTimer = setTimeout(() => { setMode('ios'); setVisible(true); }, 2500);
        }

        const onInstalled = () => { setVisible(false); localStorage.setItem('pwaPromptDismissed', '1'); };
        window.addEventListener('appinstalled', onInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBip);
            window.removeEventListener('appinstalled', onInstalled);
            if (iosTimer) clearTimeout(iosTimer);
        };
    }, []);

    const dismiss = () => { setVisible(false); localStorage.setItem('pwaPromptDismissed', '1'); };

    const install = async () => {
        if (!deferred) return;
        deferred.prompt();
        try { await deferred.userChoice; } catch { /* ignore */ }
        setDeferred(null);
        setVisible(false);
        localStorage.setItem('pwaPromptDismissed', '1');
    };

    if (!visible) return null;

    return (
        <div style={{
            position: 'fixed', insetInlineStart: '50%', transform: 'translateX(-50%)', bottom: '16px',
            zIndex: 1500, width: 'min(420px, calc(100vw - 24px))',
            background: 'rgba(10,17,32,0.92)', backdropFilter: 'blur(16px)',
            border: '1px solid var(--bd2)', borderRadius: '16px', padding: '0.9rem 1rem',
            boxShadow: '0 20px 50px -16px rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', gap: '0.8rem',
            fontFamily: 'Rubik, sans-serif', color: 'var(--text)'
        }}>
            <img src="/pwa-192x192.png" alt="" style={{ width: 44, height: 44, borderRadius: 11, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{t('install_title')}</div>
                {mode === 'ios' && <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 2, lineHeight: 1.5 }}>{t('install_ios')}</div>}
            </div>
            {mode === 'android' && (
                <button onClick={install} style={{
                    border: 'none', background: 'linear-gradient(135deg,var(--primary),var(--deep))', color: '#fff',
                    fontWeight: 800, fontFamily: 'inherit', fontSize: '0.9rem', padding: '0.6rem 1.1rem',
                    borderRadius: '11px', cursor: 'pointer', flexShrink: 0
                }}>{t('install_btn')}</button>
            )}
            <button onClick={dismiss} aria-label={t('install_later')} style={{
                border: '1px solid var(--glass-border)', background: 'var(--glass-2)', color: 'var(--text)',
                width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', flexShrink: 0, fontSize: '0.95rem'
            }}>✕</button>
        </div>
    );
}
