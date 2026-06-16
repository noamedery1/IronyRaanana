import { useState, useEffect } from 'react';
import { getActiveClub } from '../clubConfig.js';

const TrainerEditModal = ({
    isOpen,
    onClose,
    sessionData, // { team, coach, day, time, raw, row, col }
    sheetUrl, // unused (kept for prop compatibility) — now DB-backed
    availableLocations = [] // Optional: List of halls/locations to choose from
}) => {
    const [step, setStep] = useState('AUTH'); // 'AUTH', 'EDIT'
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [editType, setEditType] = useState('CHANGE'); // 'CHANGE', 'CANCEL', 'MOVE'
    const [newTime, setNewTime] = useState('');
    const [newLocation, setNewLocation] = useState('');
    const [newDay, setNewDay] = useState('');
    const [isCustomLocation, setIsCustomLocation] = useState(false);
    const [reason, setReason] = useState('');

    useEffect(() => {
        if (step === 'EDIT' && sessionData) {
            setNewTime(sessionData.time || '');
            setNewLocation(sessionData.location || '');
            setIsCustomLocation(false);
            setNewDay('');
        }
    }, [step, sessionData]);

    if (!isOpen || !sessionData) return null;

    const time = sessionData.time || '';
    const loc = sessionData.location || '';

    const hasChanges = editType === 'CHANGE'
        ? (newTime !== time || newLocation !== loc)
        : (editType === 'MOVE' ? (newDay && newTime && newLocation) : true);

    const handleAuth = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`/api/${getActiveClub().slug}/trainers/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: sessionData.coach, code: password }),
            });

            const data = await response.json();

            if (data.valid) {
                setStep('EDIT');
            } else {
                setError('סיסמה שגויה');
            }
        } catch (err) {
            console.error(err);
            setError('שגיאת תקשורת');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!reason) {
            alert('חובה לציין סיבה');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                trainerName: sessionData.coach,
                team: sessionData.team,
                day: sessionData.day,
                time: sessionData.raw,
                type: editType,
                newTime: (editType === 'CHANGE' || editType === 'MOVE') ? newTime : '',
                newLocation: (editType === 'CHANGE' || editType === 'MOVE') ? newLocation : '',
                newDay: editType === 'MOVE' ? newDay : '',
                reason: reason,
            };

            await fetch(`/api/${getActiveClub().slug}/requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            alert('הבקשה נשלחה לאישור המנהל!');
            onClose();
        } catch (err) {
            alert('שגיאה בשליחה');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="tmodal-overlay" onClick={onClose}>
            <div className="tmodal" onClick={(e) => e.stopPropagation()}>
                <button onClick={onClose} className="tmodal-close">✕</button>

                <h3 className="tmodal-title">{step === 'AUTH' ? 'הזדהות מאמן' : 'עריכת אימון'}</h3>

                <div className="tmodal-info">
                    <strong>{sessionData.team}</strong><br />
                    {sessionData.day} | {sessionData.time}
                </div>

                {step === 'AUTH' && (
                    <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                        <div className="tmodal-field">
                            <label>שם מאמן (מזוהה אוטומטית)</label>
                            <input type="text" value={sessionData.coach || 'לא מוגדר מאמן'} disabled className="tmodal-input" />
                            {!sessionData.coach && <div className="tmodal-err" style={{ marginTop: '0.4rem' }}>לא ניתן לערוך: לא משויך מאמן לקבוצה זו</div>}
                        </div>

                        <div className="tmodal-field">
                            <label>סיסמה / קוד אישי</label>
                            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="tmodal-input" disabled={!sessionData.coach} />
                        </div>

                        <button type="submit" disabled={loading || !sessionData.coach} className="tmodal-btn">
                            {loading ? 'מאמת…' : 'המשך'}
                        </button>
                        {error && <div className="tmodal-err">{error}</div>}
                    </form>
                )}

                {step === 'EDIT' && (
                    <div>
                        <div className="tmodal-types">
                            <button onClick={() => setEditType('CHANGE')} className={`tmodal-type ${editType === 'CHANGE' ? 'on' : ''}`}>שינוי פרטים</button>
                            <button onClick={() => setEditType('MOVE')} className={`tmodal-type ${editType === 'MOVE' ? 'on' : ''}`}>החלפת יום</button>
                            <button onClick={() => setEditType('CANCEL')} className={`tmodal-type ${editType === 'CANCEL' ? 'on' : ''}`}>ביטול</button>
                        </div>

                        {(editType === 'CHANGE' || editType === 'MOVE') && (
                            <>
                                {editType === 'MOVE' && (
                                    <div className="tmodal-field">
                                        <label>יום חדש</label>
                                        <select value={newDay} onChange={(e) => setNewDay(e.target.value)} className="tmodal-input">
                                            <option value="">בחר יום…</option>
                                            {['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(d => (<option key={d} value={d}>{d}</option>))}
                                        </select>
                                    </div>
                                )}

                                <div className="tmodal-field">
                                    <label>שעה</label>
                                    <input type="text" value={newTime} onChange={(e) => setNewTime(e.target.value)} placeholder="שעה" className="tmodal-input" />
                                </div>

                                <div className="tmodal-field">
                                    <label>מיקום / אולם</label>
                                    {availableLocations && availableLocations.length > 0 ? (
                                        <>
                                            <select
                                                value={isCustomLocation ? 'OTHER' : newLocation}
                                                onChange={(e) => {
                                                    if (e.target.value === 'OTHER') { setIsCustomLocation(true); setNewLocation(''); }
                                                    else { setIsCustomLocation(false); setNewLocation(e.target.value); }
                                                }}
                                                className="tmodal-input"
                                            >
                                                <option value="">בחר אולם…</option>
                                                {availableLocations.map(l => (<option key={l} value={l}>{l}</option>))}
                                                <option value="OTHER">אחר / יצירת חדש…</option>
                                            </select>
                                            {isCustomLocation && (
                                                <input type="text" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="הקלד שם אולם חדש…" className="tmodal-input" style={{ marginTop: '0.5rem' }} autoFocus />
                                            )}
                                        </>
                                    ) : (
                                        <input type="text" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="מיקום" className="tmodal-input" />
                                    )}
                                </div>
                            </>
                        )}

                        <div className="tmodal-field">
                            <label>סיבה / הערה</label>
                            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="tmodal-input" style={{ resize: 'vertical' }} placeholder="לדוגמה: הקדמנו אימון…" />
                        </div>

                        <button onClick={handleSubmit} disabled={loading || !hasChanges} className="tmodal-btn">
                            {loading ? 'שולח…' : 'שלח לאישור'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TrainerEditModal;
