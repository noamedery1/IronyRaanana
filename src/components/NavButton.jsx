import { useState, useRef, useEffect } from 'react';
import { googleMapsUrl, wazeUrl, isMobileDevice } from '../utils/hallLocations';

/**
 * Navigation link/button for a hall.
 * - On mobile: opens a small chooser (Waze / Google Maps).
 * - On desktop: opens Google Maps directly.
 */
export default function NavButton({ location, label = 'ניווט במפות ‹', navWith = 'נווט עם:', style, className }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    const handleClick = (e) => {
        e.preventDefault();
        if (!location) return;
        if (isMobileDevice()) {
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
            {open && (
                <div style={{
                    position: 'absolute', bottom: '130%', right: 0, zIndex: 30,
                    background: 'var(--ink2)', border: '1px solid var(--bd2)', borderRadius: '12px',
                    padding: '0.5rem', boxShadow: '0 16px 40px -16px rgba(0,0,0,0.8)',
                    display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: '160px'
                }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', padding: '0 0.3rem 0.2rem' }}>{navWith}</div>
                    <button onClick={() => openIn(wazeUrl(location))} style={navItemStyle('#33ccff')}>🧭 Waze</button>
                    <button onClick={() => openIn(googleMapsUrl(location))} style={navItemStyle('#34d058')}>📍 Google Maps</button>
                </div>
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
