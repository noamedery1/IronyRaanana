import { getActiveClub } from '../clubConfig.js';
import { sportEmoji } from '../sportLabels.js';

// The club's crest for login/portal screens. Shows the uploaded club logo when there is
// one; otherwise a sport-aware emoji (⚽ / 🏀 / …) instead of a hardcoded basketball.
export default function BrandMark({ size = 64 }) {
    const club = getActiveClub();
    const src = club.logo || club.icon192 || club.icon512;
    const box = {
        width: size, height: size, margin: '0 auto 1rem', borderRadius: 16,
        display: 'grid', placeItems: 'center', overflow: 'hidden',
        boxShadow: '0 12px 30px -10px rgba(0,0,0,0.55)', flexShrink: 0,
    };
    if (src) {
        return (
            <div style={{ ...box, background: '#fff' }}>
                <img src={src} alt={club.name || ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
        );
    }
    return (
        <div style={{ ...box, background: 'linear-gradient(135deg,#3b82f6,#0891b2)', fontSize: Math.round(size * 0.47) }}>
            {sportEmoji()}
        </div>
    );
}
