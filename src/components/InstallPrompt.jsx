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
        <div
            onClick={dismiss}
            style={{
                position: 'fixed', inset: 0, zIndex: 1500,
                background: 'rgba(4,8,18,0.62)', backdropFilter: 'blur(6px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
                fontFamily: 'Rubik, sans-serif',
                animation: 'pwaFadeIn 0.25s ease'
            }}
        >
            <style>{`@keyframes pwaFadeIn{from{opacity:0}to{opacity:1}}@keyframes pwaPop{from{opacity:0;transform:translateY(16px) scale(0.96)}to{opacity:1;transform:none}}`}</style>
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    position: 'relative', width: 'min(380px, 100%)',
                    background: 'rgba(12,19,36,0.96)', backdropFilter: 'blur(20px)',
                    border: '1px solid var(--bd2)', borderRadius: '22px', padding: '1.6rem 1.4rem 1.4rem',
                    boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)', color: 'var(--text)', textAlign: 'center',
                    animation: 'pwaPop 0.3s cubic-bezier(0.16,1,0.3,1)'
                }}
            >
                <button onClick={dismiss} aria-label={t('install_later')} style={{
                    position: 'absolute', insetInlineEnd: 12, top: 12,
                    border: '1px solid var(--glass-border)', background: 'var(--glass-2)', color: 'var(--text)',
                    width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', fontSize: '0.95rem'
                }}>✕</button>

                <img src="/pwa-192x192.png" alt="" style={{
                    width: 72, height: 72, borderRadius: 18, margin: '0 auto 0.9rem',
                    boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)'
                }} />
                <div style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.4rem' }}>{t('install_title')}</div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: '1.2rem' }}>
                    {mode === 'ios' ? t('install_ios') : t('install_desc')}
                </div>

                {mode === 'android' && (
                    <button onClick={install} style={{
                        width: '100%', border: 'none', background: 'linear-gradient(135deg,var(--primary),var(--deep))',
                        color: '#fff', fontWeight: 800, fontFamily: 'inherit', fontSize: '1rem', padding: '0.85rem',
                        borderRadius: '13px', cursor: 'pointer'
                    }}>{t('install_btn')}</button>
                )}
                <button onClick={dismiss} style={{
                    width: '100%', marginTop: '0.6rem', border: 'none', background: 'transparent',
                    color: 'var(--text-dim)', fontWeight: 600, fontFamily: 'inherit', fontSize: '0.9rem',
                    padding: '0.5rem', cursor: 'pointer'
                }}>{t('install_later')}</button>
            </div>
        </div>
    );
}
