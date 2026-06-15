import { useState, useEffect } from 'react';
import { useI18n } from '../i18n.jsx';
import { hasNativePrompt, isIOS, isStandalone, subscribe, promptInstall } from '../installState.js';

// Install affordances (shown on every screen until the app is installed):
// - First visit (not dismissed): a prominent centered modal.
// - Always: a persistent pill. Native prompt if available, otherwise manual instructions
//   (⋮ → Add to Home Screen) — so an install option is present even when Chrome won't
//   auto-prompt (e.g. desktop, in-app browsers).
export default function InstallPrompt() {
    const { t } = useI18n();
    const [, force] = useState(0);
    const [dismissed, setDismissed] = useState(localStorage.getItem('pwaPromptDismissed') === '1');
    const [showTip, setShowTip] = useState(false);

    // Re-render when the install prompt becomes available / the app gets installed.
    useEffect(() => subscribe(() => force((n) => n + 1)), []);

    if (isStandalone()) return null; // already installed → nothing to do

    const ios = isIOS();
    const tipText = ios ? t('install_ios') : t('install_manual');

    const doInstall = async () => {
        if (hasNativePrompt()) { await promptInstall(); return; }
        setShowTip(true); // no native prompt → show manual steps
    };
    const dismiss = () => { setDismissed(true); localStorage.setItem('pwaPromptDismissed', '1'); };

    // ===== First-visit prominent modal =====
    if (!dismissed) {
        return (
            <div
                onClick={dismiss}
                style={{
                    position: 'fixed', inset: 0, zIndex: 1500,
                    background: 'rgba(4,8,18,0.62)', backdropFilter: 'blur(6px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
                    fontFamily: 'Rubik, sans-serif', animation: 'pwaFadeIn 0.25s ease',
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
                        animation: 'pwaPop 0.3s cubic-bezier(0.16,1,0.3,1)',
                    }}
                >
                    <button onClick={dismiss} aria-label={t('install_later')} style={{
                        position: 'absolute', insetInlineEnd: 12, top: 12,
                        border: '1px solid var(--glass-border)', background: 'var(--glass-2)', color: 'var(--text)',
                        width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', fontSize: '0.95rem',
                    }}>✕</button>

                    <img src="/pwa-192x192.png" alt="" style={{
                        width: 72, height: 72, borderRadius: 18, margin: '0 auto 0.9rem',
                        boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)',
                    }} />
                    <div style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.4rem' }}>{t('install_title')}</div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: '1.2rem' }}>
                        {ios ? t('install_ios') : t('install_desc')}
                    </div>

                    {!ios && (
                        <button onClick={doInstall} style={{
                            width: '100%', border: 'none', background: 'linear-gradient(135deg,var(--primary),var(--deep))',
                            color: '#fff', fontWeight: 800, fontFamily: 'inherit', fontSize: '1rem', padding: '0.85rem',
                            borderRadius: '13px', cursor: 'pointer',
                        }}>{t('install_btn')}</button>
                    )}
                    {showTip && <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.6, marginTop: '0.7rem' }}>{tipText}</div>}
                    <button onClick={dismiss} style={{
                        width: '100%', marginTop: '0.6rem', border: 'none', background: 'transparent',
                        color: 'var(--text-dim)', fontWeight: 600, fontFamily: 'inherit', fontSize: '0.9rem',
                        padding: '0.5rem', cursor: 'pointer',
                    }}>{t('install_later')}</button>
                </div>
            </div>
        );
    }

    // ===== Persistent pill (always, until installed) =====
    return (
        <div dir="rtl" style={{ position: 'fixed', right: '16px', bottom: '72px', zIndex: 1401, fontFamily: 'Rubik, sans-serif' }}>
            {showTip && (
                <div style={{
                    maxWidth: 240, marginBottom: 8, background: 'rgba(10,17,32,0.95)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 12, padding: '0.6rem 0.8rem',
                    fontSize: '0.78rem', lineHeight: 1.5, boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)',
                }}>{tipText}</div>
            )}
            <button onClick={doInstall} style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: 'linear-gradient(135deg,#ff7a18,#c2410c)', color: '#fff', border: 'none',
                padding: '0.6rem 1rem', borderRadius: '30px', fontWeight: 800, fontFamily: 'inherit',
                fontSize: '0.85rem', cursor: 'pointer', boxShadow: '0 8px 22px -6px rgba(255,122,24,0.7)',
            }}>📲 {t('install_btn')}</button>
        </div>
    );
}
