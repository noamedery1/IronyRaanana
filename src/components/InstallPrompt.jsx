import { useState, useEffect } from 'react';
import { useI18n } from '../i18n.jsx';
import { hasNativePrompt, isIOS, isStandalone, subscribe, promptInstall, isInstalled } from '../installState.js';
import { getActiveClub } from '../clubConfig.js';
import { sportEmoji } from '../sportLabels.js';
import { resetApp } from '../resetApp.js';

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
    const [showIosGuide, setShowIosGuide] = useState(false);
    const [ackInstalled, setAckInstalled] = useState(false);

    // Re-render when the install prompt becomes available / the app gets installed.
    useEffect(() => subscribe(() => force((n) => n + 1)), []);

    if (isStandalone()) return null; // already installed → nothing to do

    // Install is a parent-facing action. Hide it on manager/superuser screens — its
    // floating pill would otherwise overlap the admin sidebar menu.
    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    if (/\/admin(\/|$)/.test(path) || path.startsWith('/superuser')) return null;

    // Just installed (still on the browser tab): replace the install UI with a clear
    // "open the app from your home screen" confirmation, so the old prompt doesn't linger.
    if (isInstalled() && !ackInstalled) {
        return (
            <div dir="rtl" style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(4,8,18,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'Rubik, sans-serif' }}>
                <div style={{ width: 'min(360px,100%)', background: 'rgba(12,19,36,0.97)', border: '1px solid var(--bd2, rgba(255,255,255,0.12))', borderRadius: '22px', padding: '1.8rem 1.4rem', textAlign: 'center', color: '#e8edf7', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)' }}>
                    <div style={{ fontSize: '2.6rem', marginBottom: '0.4rem' }}>✅</div>
                    <div style={{ fontWeight: 800, fontSize: '1.15rem', marginBottom: '0.5rem' }}>האפליקציה הותקנה!</div>
                    <div style={{ fontSize: '0.9rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: '1.2rem' }}>
                        סגרו את הדפדפן ופתחו את האפליקציה מאייקון <b>{getActiveClub().name}</b> במסך הבית — משם היא תיפתח ישר במסך המתאים לכם.
                    </div>
                    <button onClick={() => setAckInstalled(true)} style={{ background: 'linear-gradient(135deg,#3b82f6,#0891b2)', color: '#fff', fontWeight: 800, padding: '0.7rem 1.4rem', borderRadius: '999px', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>הבנתי</button>
                </div>
            </div>
        );
    }

    const ios = isIOS();
    const tipText = ios ? t('install_ios') : t('install_manual');
    const club = getActiveClub();
    const installIcon = club.icon192 || club.icon512 || club.logo || '/pwa-192x192.png';

    const doInstall = async () => {
        if (hasNativePrompt()) { await promptInstall(); return; } // Android/Chrome: real one-tap install
        if (ios) { setShowIosGuide(true); return; }               // iOS: Apple has no install API → visual guide
        setShowTip(true);                                         // other: manual steps text
    };
    const dismiss = () => { setDismissed(true); localStorage.setItem('pwaPromptDismissed', '1'); };

    // iOS can't be installed programmatically (Apple restriction) — this is a big, friendly
    // step-by-step overlay so non-technical parents can follow Share → Add to Home Screen.
    if (showIosGuide) {
        const Step = ({ n, children, icon }) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', textAlign: 'right', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '0.7rem 0.8rem' }}>
                <div style={{ flex: '0 0 auto', width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#0891b2)', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.95rem' }}>{n}</div>
                <div style={{ flex: 1, color: '#e8edf7', fontSize: '0.95rem', lineHeight: 1.5 }}>{children}</div>
                <div style={{ flex: '0 0 auto', fontSize: '1.5rem' }}>{icon}</div>
            </div>
        );
        return (
            <div dir="rtl" onClick={() => setShowIosGuide(false)} style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(4,8,18,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px', fontFamily: 'Rubik, sans-serif' }}>
                <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(380px,100%)', background: 'rgba(12,19,36,0.98)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '22px', padding: '1.5rem 1.3rem', color: '#e8edf7', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)' }}>
                    <div style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.3rem' }}>התקנה על אייפון 📲</div>
                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem', marginBottom: '1.1rem' }}>3 צעדים קצרים ב-Safari</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        <Step n={1} icon={<span style={{ color: '#38bdf8' }}>&#x2BAA;</span>}>הקישו על כפתור <b>השיתוף</b> (הריבוע עם החץ ↑) בתחתית המסך</Step>
                        <Step n={2} icon="➕">גללו ובחרו <b>&quot;הוספה למסך הבית&quot;</b></Step>
                        <Step n={3} icon="✅">הקישו <b>&quot;הוסף&quot;</b> למעלה מימין — וסיימתם!</Step>
                    </div>
                    <div style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.45)', borderRadius: 12, padding: '0.6rem 0.8rem', marginTop: '0.9rem', color: '#fde68a', fontSize: '0.8rem', lineHeight: 1.5 }}>
                        ⚠️ חשוב: אם פתחתם מוואטסאפ — הקישו קודם ⋯ ובחרו <b>&quot;פתח בדפדפן&quot; / Safari</b>, אחרת כפתור השיתוף לא יראה את האפשרות.
                    </div>
                    <button onClick={() => setShowIosGuide(false)} style={{ width: '100%', marginTop: '1rem', border: 'none', background: 'linear-gradient(135deg,#3b82f6,#0891b2)', color: '#fff', fontWeight: 800, fontFamily: 'inherit', fontSize: '1rem', padding: '0.8rem', borderRadius: '13px', cursor: 'pointer' }}>הבנתי, בוא נתחיל</button>
                    <button onClick={() => resetApp()} style={{ width: '100%', marginTop: '0.5rem', border: 'none', background: 'transparent', color: '#64748b', fontWeight: 600, fontFamily: 'inherit', fontSize: '0.82rem', padding: '0.4rem', cursor: 'pointer' }}>משהו תקוע? אפסו את האפליקציה ונסו שוב 🔄</button>
                </div>
            </div>
        );
    }

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

                    <img src={installIcon} alt="" style={{
                        width: 72, height: 72, borderRadius: 18, margin: '0 auto 0.9rem',
                        boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)',
                    }} />
                    <div style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: '0.4rem' }}>{t('install_title')} {sportEmoji()}</div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: '1.2rem' }}>
                        {t('install_desc')}
                    </div>

                    {/* One button for everyone: Android triggers the native prompt, iOS opens the visual guide. */}
                    <button onClick={doInstall} style={{
                        width: '100%', border: 'none', background: 'linear-gradient(135deg,var(--primary),var(--deep))',
                        color: '#fff', fontWeight: 800, fontFamily: 'inherit', fontSize: '1rem', padding: '0.85rem',
                        borderRadius: '13px', cursor: 'pointer',
                    }}>{ios ? '📲 התקנה — הראו לי איך' : t('install_btn')}</button>
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
                background: 'linear-gradient(135deg,#3b82f6,#0891b2)', color: '#fff', border: 'none',
                padding: '0.6rem 1rem', borderRadius: '30px', fontWeight: 800, fontFamily: 'inherit',
                fontSize: '0.85rem', cursor: 'pointer', boxShadow: '0 8px 22px -6px rgba(255,122,24,0.7)',
            }}>📲 {t('install_btn')}</button>
        </div>
    );
}
