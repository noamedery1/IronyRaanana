import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { googleMapsUrl, wazeUrl, isMobileDevice } from '../utils/hallLocations';

/**
 * Navigation link/button for a hall.
 * - On mobile: opens a small chooser (Waze / Google Maps).
 * - On desktop: opens Google Maps directly.
 */
export default function NavButton({ location, label = 'ניווט במפות ‹', navWith = 'נווט עם:', style, className }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null); // fixed-position coords for the menu
    const ref = useRef(null);
    const menuRef = useRef(null);

    // Position the menu relative to the VIEWPORT. The menu is rendered through a portal to
    // <body> (see below) so it escapes the map card's entrance-animation transform — a
    // transformed ancestor would otherwise make position:fixed resolve against that card
    // instead of the viewport, so the menu drifted off-screen once the page was scrolled.
    // Opens above the trigger when there's room, otherwise below; right edge aligned (RTL).
    const place = () => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const MENU_H = 132;
        const above = r.top > MENU_H + 12;
        setPos({
            right: Math.round(window.innerWidth - r.right),
            top: above ? undefined : Math.round(r.bottom + 8),
            bottom: above ? Math.round(window.innerHeight - r.top + 8) : undefined,
        });
    };

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => {
            // The menu lives in a portal outside `ref`, so check both the trigger and the menu.
            if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        const reposition = () => setOpen(false); // close on scroll/resize rather than track a stale anchor
        document.addEventListener('mousedown', onClick);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            document.removeEventListener('mousedown', onClick);
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [open]);

    const handleClick = (e) => {
        e.preventDefault();
        if (!location) return;
        if (isMobileDevice()) {
            if (!open) place();
            setOpen(o => !o);
        } else {
            window.open(googleMapsUrl(location), '_blank', 'noreferrer');
        }
    };

    const openIn = (url) => { window.open(url, '_blank', 'noreferrer'); setOpen(false); };

    return (
        <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
            <a href="#" onClick={handleClick} className={className} style={{ color: 'var(--sky)', fontWeight: 700, fontSize: '0.82rem', textDecoration: 'none', ...style }}>
                {label}
            </a>
            {open && pos && createPortal(
                <div ref={menuRef} style={{
                    position: 'fixed', right: pos.right, top: pos.top, bottom: pos.bottom, zIndex: 3000,
                    background: 'var(--ink2)', border: '1px solid var(--bd2)', borderRadius: '12px',
                    padding: '0.5rem', boxShadow: '0 16px 40px -16px rgba(0,0,0,0.55)',
                    display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '160px'
                }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', padding: '0 0.3rem 0.2rem' }}>{navWith}</div>
                    <button onClick={() => openIn(wazeUrl(location))} style={navItemStyle('#33ccff')}>🧭 Waze</button>
                    <button onClick={() => openIn(googleMapsUrl(location))} style={navItemStyle('#34d058')}>📍 Google Maps</button>
                </div>,
                document.body,
            )}
        </span>
    );
}

const navItemStyle = (accent) => ({
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    background: 'var(--glass-2)', color: 'var(--text)', border: '1px solid var(--glass-border)',
    borderRadius: '9px', padding: '0.55rem 0.7rem', cursor: 'pointer', fontFamily: 'Rubik, sans-serif',
    fontWeight: 700, fontSize: '0.85rem', borderRight: `3px solid ${accent}`
});
