import { useMemo } from 'react';
import { cleanHallName } from '../utils/hallLocations';

/**
 * Hall settings page.
 * Lets the admin define, per hall:
 *   - capacity type: FULL (1 team) | HALF (2 teams, half-court each) | MULTI (N courts)
 *   - exact address (used by the public map / navigation)
 * Stored in `hallConfig` (object keyed by cleaned hall name) and persisted to localStorage
 * by the parent dashboard. Drives conflict detection in the Preview board.
 */
export default function HallsConfig({ rawRows, indices, hallConfig, setHallConfig }) {
    const dayStart = indices?.dayStart || 1;

    const halls = useMemo(() => {
        const set = new Set();
        (rawRows || []).forEach(row => {
            for (let d = 0; d < 7; d++) {
                const cell = row?.[dayStart + d];
                if (!cell || typeof cell !== 'string') continue;
                cell.split('\n').forEach(line => {
                    const name = cleanHallName(line);
                    if (name && name.length > 1) set.add(name);
                });
            }
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
    }, [rawRows, dayStart]);

    const getCfg = (hall) => hallConfig[hall] || { type: 'FULL', courts: 2, address: '' };

    const update = (hall, changes) => {
        setHallConfig(prev => ({ ...prev, [hall]: { ...getCfg(hall), ...changes } }));
    };

    if (!rawRows || rawRows.length === 0) {
        return <div style={{ color: 'var(--text-dim)' }}>התחבר לגיליון תחילה כדי לטעון את רשימת האולמות.</div>;
    }

    return (
        <div className="cc">
            <div className="cc-toolbar">
                <div className="cc-title">🏟️ הגדרת אולמות</div>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                הגדר לכל אולם את הקיבולת (כמה קבוצות יכולות להתאמן בו במקביל) ואת הכתובת המדויקת לניווט.
                הקיבולת משפיעה ישירות על זיהוי ההתנגשויות בלוח.
            </p>

            <div className="hc-grid">
                <div className="hc-head">
                    <div>אולם</div><div>קיבולת</div><div>מגרשים</div><div>כתובת מדויקת (לניווט)</div>
                </div>
                {halls.map(hall => {
                    const cfg = getCfg(hall);
                    return (
                        <div key={hall} className="hc-row">
                            <div className="hc-name">📍 {hall}</div>
                            <div className="hc-types">
                                <button className={`cc-type ${cfg.type === 'FULL' ? 'on' : ''}`} onClick={() => update(hall, { type: 'FULL' })}>מלא (1)</button>
                                <button className={`cc-type ${cfg.type === 'HALF' ? 'on' : ''}`} onClick={() => update(hall, { type: 'HALF' })}>חצי-חצי (2)</button>
                                <button className={`cc-type ${cfg.type === 'MULTI' ? 'on' : ''}`} onClick={() => update(hall, { type: 'MULTI' })}>רב-מגרשי</button>
                            </div>
                            <div>
                                {cfg.type === 'MULTI' ? (
                                    <input type="number" min="2" max="12" value={cfg.courts || 2}
                                        onChange={e => update(hall, { courts: Math.max(2, parseInt(e.target.value) || 2) })}
                                        className="hc-input" style={{ width: '70px', textAlign: 'center' }} />
                                ) : (
                                    <span style={{ color: 'var(--text-muted)' }}>{cfg.type === 'HALF' ? '2' : '1'}</span>
                                )}
                            </div>
                            <div>
                                <input type="text" value={cfg.address || ''} placeholder={`${hall}, רעננה`}
                                    onChange={e => update(hall, { address: e.target.value })} className="hc-input" style={{ width: '100%' }} />
                            </div>
                        </div>
                    );
                })}
                {halls.length === 0 && <div style={{ color: 'var(--text-dim)', padding: '1rem' }}>לא נמצאו אולמות בנתונים.</div>}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.8rem' }}>
                ✓ ההגדרות נשמרות אוטומטית. כתובת שתוזן כאן תשמש את כפתורי הניווט (Waze / Google Maps) באתר במכשיר זה.
            </p>
        </div>
    );
}
