import { useState } from 'react';
import { getTheme, toggleTheme } from '../theme.js';

// Sun/Moon button to switch light/dark. Small, fits next to the language switcher.
export default function ThemeToggle({ style }) {
    const [theme, setTheme] = useState(getTheme());
    const flip = () => setTheme(toggleTheme());
    const light = theme === 'light';
    return (
        <button
            onClick={flip}
            title={light ? 'מצב כהה' : 'מצב בהיר'}
            aria-label={light ? 'עבור למצב כהה' : 'עבור למצב בהיר'}
            style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 38, height: 38, borderRadius: 11, cursor: 'pointer',
                border: '1px solid var(--glass-border)', background: 'var(--glass-2)',
                color: 'var(--text)', fontSize: '1.05rem', flexShrink: 0, fontFamily: 'inherit',
                ...style,
            }}
        >
            {light ? '🌙' : '☀️'}
        </button>
    );
}
