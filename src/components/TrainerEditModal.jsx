import { useState, useEffect } from 'react';

const TrainerEditModal = ({
    isOpen,
    onClose,
    sessionData, // { team, coach, day, time, raw, row, col }
    sheetUrl // LIVE_SHEET_API
}) => {
    const [step, setStep] = useState('AUTH'); // 'AUTH', 'EDIT'
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Edit Form State
    const [editType, setEditType] = useState('CHANGE'); // 'CHANGE', 'CANCEL'
    const [newTime, setNewTime] = useState('');
    const [newLocation, setNewLocation] = useState('');
    const [reason, setReason] = useState('');

    // Initialize state with current values when switching to EDIT
    useEffect(() => {
        if (step === 'EDIT' && sessionData) {
            setNewTime(sessionData.time || '');
            setNewLocation(sessionData.location || '');
        }
    }, [step, sessionData]);

    if (!isOpen || !sessionData) return null;

    // Check if changes were made
    const time = sessionData.time || '';
    const loc = sessionData.location || '';

    const hasChanges = editType === 'CHANGE'
        ? (newTime !== time || newLocation !== loc)
        : true; // CANCEL is always a change

    const handleAuth = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Validate against Apps Script
            const response = await fetch(sheetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'trainerLogin',
                    name: sessionData.coach, // We use the coach name from the cell/team
                    code: password
                })
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
                action: 'submitRequest',
                trainerName: sessionData.coach,
                team: sessionData.team,
                day: sessionData.day,
                time: sessionData.raw,
                type: editType,
                newTime: editType === 'CHANGE' ? newTime : '',
                newLocation: editType === 'CHANGE' ? newLocation : '',
                details: editType === 'CANCEL'
                    ? `ביטול אימון. סיבה: ${reason}`
                    : `שינוי ל: ${newTime} ב-${newLocation}. סיבה: ${reason}`,
                reason: reason,
                row: sessionData.row,
                col: sessionData.col
            };

            await fetch(sheetUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
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
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: 'white', borderRadius: '12px', padding: '1.5rem',
                width: '90%', maxWidth: '400px', position: 'relative'
            }}>
                <button
                    onClick={onClose}
                    style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}
                >✕</button>

                <h3 style={{ marginTop: 0, color: '#BE185D', textAlign: 'center' }}>
                    {step === 'AUTH' ? 'הזדהות מאמן' : 'עריכת אימון'}
                </h3>

                <div style={{ background: '#f8fafc', padding: '0.8rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem', textAlign: 'center' }}>
                    <strong>{sessionData.team}</strong><br />
                    {sessionData.day} | {sessionData.time}
                </div>

                {step === 'AUTH' && (
                    <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>שם מאמן (מזוהה אוטומטית)</label>
                            <input
                                type="text"
                                value={sessionData.coach || 'לא מוגדר מאמן'}
                                disabled
                                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', background: '#f1f5f9' }}
                            />
                            {!sessionData.coach && <div style={{ color: 'red', fontSize: '0.8rem' }}>לא ניתן לערוך: לא משויך מאמן לקבוצה זו</div>}
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>סיסמה / קוד אישי</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd' }}
                                disabled={!sessionData.coach}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading || !sessionData.coach}
                            style={{ background: '#BE185D', color: 'white', border: 'none', padding: '0.8rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                            {loading ? 'מאמת...' : 'המשך'}
                        </button>
                        {error && <div style={{ color: 'red', textAlign: 'center' }}>{error}</div>}
                    </form>
                )}

                {step === 'EDIT' && (
                    <div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                            <button
                                onClick={() => setEditType('CHANGE')}
                                style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: editType === 'CHANGE' ? '2px solid #BE185D' : '1px solid #ddd', background: editType === 'CHANGE' ? '#fdf2f8' : 'white', color: editType === 'CHANGE' ? '#BE185D' : '#64748b' }}
                            >שינוי</button>
                            <button
                                onClick={() => setEditType('CANCEL')}
                                style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: editType === 'CANCEL' ? '2px solid #ef4444' : '1px solid #ddd', background: editType === 'CANCEL' ? '#fef2f2' : 'white', color: editType === 'CANCEL' ? '#ef4444' : '#64748b' }}
                            >ביטול</button>
                        </div>

                        {editType === 'CHANGE' && (
                            <>
                                <label style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', display: 'block' }}>שעה</label>
                                <input type="text" value={newTime} onChange={(e) => setNewTime(e.target.value)} placeholder="שעה" style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', marginBottom: '0.8rem' }} />

                                <label style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', display: 'block' }}>מיקום / אולם</label>
                                <input type="text" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="מיקום" style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', marginBottom: '0.8rem' }} />
                            </>
                        )}

                        <label style={{ fontSize: '0.85rem', color: '#666', display: 'block' }}>סיבה / הערה</label>
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd', marginBottom: '1rem' }} placeholder="לדוגמה: הקדמנו אימון..." />

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button onClick={handleSubmit} disabled={loading || !hasChanges} style={{ flex: 1, padding: '0.8rem', borderRadius: '6px', border: 'none', background: !hasChanges ? '#cbd5e1' : '#BE185D', color: 'white', fontWeight: 'bold', cursor: !hasChanges ? 'not-allowed' : 'pointer' }}>
                                {loading ? 'שולח...' : 'שלח לאישור'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TrainerEditModal;
