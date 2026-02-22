import { useState } from 'react';
import Papa from 'papaparse';
import { parseCellContent } from '../utils/scheduleUtils';

const TrainerPortal = () => {
    // --------------------------------------------------------------------------
    // CONFIGURATION
    // --------------------------------------------------------------------------
    // IMPORTANT: Replace this with your actual Web App URL for the LIVE sheet
    const LIVE_SHEET_API = "https://script.google.com/macros/s/AKfycbwYvRj8HoUzqrOcteCiqRQFGAKsrU4unmv5WZm4OujxmncI5epkO32FjtVFvG2XNLw/exec";

    // We assume the live sheet ID is the one from WomenDashboard or Public
    // For now, let's hardcode the ID if known or ask user to provide it.
    // Based on previous files:
    const SHEET_ID = "1fpbkPyUIGUn_wwdJDXf4dhwHvv5Y-KRYfnmv026Gs6w"; // Default Women Sheet
    const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;

    // --------------------------------------------------------------------------
    // STATE
    // --------------------------------------------------------------------------
    const [view, setView] = useState('login'); // 'login', 'dashboard'
    const [trainer, setTrainer] = useState(null); // { name: 'Noam', teams: ['U16'] }
    const [schedule, setSchedule] = useState([]);
    const [locations, setLocations] = useState([]); // Available halls
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Login Form
    const [loginName, setLoginName] = useState('');
    const [loginCode, setLoginCode] = useState('');

    // Edit Modal
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [selectedSession, setSelectedSession] = useState(null);
    const [editType, setEditType] = useState('CHANGE'); // 'CHANGE', 'CANCEL', 'MOVE'
    const [newTime, setNewTime] = useState('');
    const [newLocation, setNewLocation] = useState('');
    const [isCustomLocation, setIsCustomLocation] = useState(false);
    const [newDay, setNewDay] = useState('');
    const [changeReason, setChangeReason] = useState('');

    // --------------------------------------------------------------------------
    // ACTIONS
    // --------------------------------------------------------------------------

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Verify against Apps Script
            const response = await fetch(LIVE_SHEET_API, {
                method: 'POST',
                // mode: 'cors' if possible, but Google usually requires 'no-cors' for simple fetch,
                // however 'no-cors' returns opaque. We can't read the response to know if login succeeded!
                // TRICK: We can use a GET request or JSONP if supported, OR we can just fetch the 'Trainers' CSV directly here 
                // and validate locally (clientside). It's less secure but for a MVP with a Code it's okay.
                // BETTER: The user asked for an "App Script" approach. 
                // Let's try to fetch the Trainers sheet as CSV to validate.
            });

            // FALLBACK STRATEGY FOR LOGIN: Read a "Trainers" tab via CSV export
            // This requires the Trainers tab to be published or visible to the heuristic.
            // If hidden, we can't CSV it easily without OAuth.
            // ALTERNATIVE: Use the API in 'cors' mode? Google Apps Script Web App set to "Anyone" supports CORS.
            // Let's assume the script handles CORS correctly (return ContentService...setMimeType(JSON)).

            // Let's try the fetch to the script
            const result = await fetch(LIVE_SHEET_API, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 'text/plain' prevents preflight
                body: JSON.stringify({
                    action: 'trainerLogin',
                    name: loginName,
                    code: loginCode
                })
            });

            // If the script is set to "Anyone", valid CORS JSON is returned.
            const data = await result.json();

            if (data.valid) {
                setTrainer({ name: data.trainerName, teams: data.teams });
                setView('dashboard');
                fetchSchedule(data.trainerName); // Load schedule
            } else {
                setError('שם משתמש או קוד שגוי');
            }

        } catch (err) {
            console.error("Login Error", err);
            // Fallback for development if script isn't ready:
            // if (loginCode === '0000') {
            //     setTrainer({ name: loginName, teams: [] });
            //     setView('dashboard');
            //     fetchSchedule(loginName);
            // } else {
            setError('שגיאת תקשורת או פרטים שגויים. וודא שהסקריפט מעודכן.');
            // }
        } finally {
            setLoading(false);
        }
    };

    const fetchSchedule = (trainerName) => {
        setLoading(true);
        Papa.parse(CSV_URL, {
            download: true,
            header: false,
            complete: (results) => {
                const rows = results.data;
                // Reuse logic from HallView/WomenDashboard to parse
                // For brevity, simple parsing logic here focusing on the Trainer

                // Find headers
                let headerRowIndex = -1;
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i][0] && rows[i][0].includes('קבוצות')) {
                        headerRowIndex = i;
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    setLoading(false);
                    return;
                }

                const headers = rows[headerRowIndex];
                const dayStartIndex = headers.findIndex(h => h && h.includes('ראשון'));
                const coachIndex = headers.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach')));

                const mySessions = [];
                const locSet = new Set();
                const now = new Date();

                rows.slice(headerRowIndex + 1).forEach((row, rIdx) => {
                    const teamName = row[0];
                    const coach = coachIndex !== -1 ? row[coachIndex] : '';

                    // Collect Locations from all valid cells
                    for (let d = 0; d < 7; d++) {
                        const colIdx = dayStartIndex + d;
                        const cell = row[colIdx];
                        if (cell && cell.trim() && !cell.toLowerCase().includes('xxx')) {
                            const { location } = parseCellContent(cell);
                            if (location && location.trim().length > 1) locSet.add(location.trim());
                        }
                    }

                    // Filter: Coach match OR (if undefined) match team name? 
                    // Let's match strictly by Coach Column if possible, or fuzzy match if user is assigned to team
                    const isMyCoach = coach && coach.trim().toLowerCase() === trainerName.toLowerCase();

                    if (isMyCoach) {
                        for (let d = 0; d < 7; d++) {
                            const colIdx = dayStartIndex + d;
                            const cell = row[colIdx];
                            if (cell && cell.trim()) {
                                const dayName = headers[colIdx];
                                mySessions.push({
                                    id: `${rIdx}-${colIdx}`,
                                    team: teamName,
                                    day: dayName,
                                    date: dayName.split(' ')[1] || '', // Simple date extract
                                    raw: cell,
                                    originalrow: rIdx, // To help script find it
                                    originalcol: colIdx
                                });
                            }
                        }
                    }
                });

                setLocations(Array.from(locSet).sort());
                setSchedule(mySessions);
                setLoading(false);
            }
        });
    };

    const handleEditClick = (session) => {
        setSelectedSession(session);
        setEditType('CHANGE');
        setNewTime('');
        setNewLocation('');
        setIsCustomLocation(false);
        setNewDay('');
        setChangeReason('');
        setEditModalOpen(true);
    };

    const submitRequest = async () => {
        if (!changeReason) {
            alert('אנא פרט את סיבת השינוי');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                action: 'submitRequest',
                trainerName: trainer.name,
                team: selectedSession.team,
                day: selectedSession.day,
                time: selectedSession.raw, // Current value
                type: editType,
                newTime: (editType === 'CHANGE' || editType === 'MOVE') ? newTime : '',
                newLocation: (editType === 'CHANGE' || editType === 'MOVE') ? newLocation : '',
                newDay: editType === 'MOVE' ? newDay : '',
                details: editType === 'CANCEL'
                    ? `ביטול אימון. סיבה: ${changeReason}`
                    : (editType === 'MOVE'
                        ? `הזזה ליום ${newDay}, שעה ${newTime}, ${newLocation}. סיבה: ${changeReason}`
                        : `שינוי ל: ${newTime} ב-${newLocation}. סיבה: ${changeReason}`),
                // Metadata for admin
                row: selectedSession.originalrow,
                col: selectedSession.originalcol
            };

            await fetch(LIVE_SHEET_API, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            alert('הבקשה נשלחה לאישור המנהל!');
            setEditModalOpen(false);
        } catch (err) {
            alert('שגיאה בשליחת הבקשה');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // --------------------------------------------------------------------------
    // RENDER
    // --------------------------------------------------------------------------

    if (view === 'login') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f3f4f6', fontFamily: 'Rubik' }}>
                <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', width: '90%', maxWidth: '350px', textAlign: 'center' }}>
                    <h2 style={{ color: '#BE185D', marginBottom: '1.5rem' }}>портаל מאמנים</h2>
                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <input
                            type="text"
                            placeholder="שם מאמן (כפי שמופיע בלוז)"
                            value={loginName}
                            onChange={(e) => setLoginName(e.target.value)}
                            style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid #ddd', textAlign: 'center' }}
                        />
                        <input
                            type="password"
                            placeholder="קוד אישי"
                            value={loginCode}
                            onChange={(e) => setLoginCode(e.target.value)}
                            style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid #ddd', textAlign: 'center' }}
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            style={{ background: '#BE185D', color: 'white', border: 'none', padding: '0.8rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                            {loading ? 'מתחבר...' : 'כניסה'}
                        </button>
                    </form>
                    {error && <div style={{ color: 'red', marginTop: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                </div>
            </div>
        );
    }

    return (
        <div dir="rtl" style={{ fontFamily: 'Rubik', minHeight: '100vh', background: '#f8fafc', paddingBottom: '2rem' }}>
            {/* Header */}
            <header style={{ background: 'white', padding: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: '#334155' }}>שלום, {trainer.name}</h3>
                <button onClick={() => setView('login')} style={{ background: 'none', border: '1px solid #cbd5e1', padding: '0.3rem 0.8rem', borderRadius: '4px', fontSize: '0.8rem' }}>יציאה</button>
            </header>

            {/* Schedule List */}
            <div style={{ maxWidth: '600px', margin: '1rem auto', padding: '0 1rem' }}>
                <h4 style={{ color: '#64748b', marginBottom: '1rem' }}>האימונים שלי השבוע</h4>

                {loading && <div style={{ textAlign: 'center' }}>טוען נתונים...</div>}

                {!loading && schedule.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>לא נמצאו אימונים המשויכים אליך.</div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    {schedule.map(session => (
                        <div key={session.id} style={{ background: 'white', borderRadius: '8px', padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#334155' }}>{session.team}</div>
                                <div style={{ color: '#BE185D', fontWeight: '500' }}>{session.day}</div>
                                <div style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.2rem' }}>{session.raw}</div>
                            </div>
                            <button
                                onClick={() => handleEditClick(session)}
                                style={{
                                    background: '#f1f5f9',
                                    border: 'none',
                                    borderRadius: '50%',
                                    width: '40px',
                                    height: '40px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: '#0f172a'
                                }}
                            >
                                ✏️
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Edit Modal */}
            {editModalOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '400px', padding: '1.5rem' }}>
                        <h3 style={{ marginTop: 0, color: '#334155' }}>בקשת שינוי / ביטול</h3>

                        <div style={{ background: '#f8fafc', padding: '0.8rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            <strong>קיים:</strong> {selectedSession?.day} - {selectedSession?.raw}
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>סוג בקשה</label>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => setEditType('CHANGE')}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: '6px', border: editType === 'CHANGE' ? '2px solid #BE185D' : '1px solid #ddd', background: editType === 'CHANGE' ? '#fdf2f8' : 'white', color: editType === 'CHANGE' ? '#BE185D' : '#64748b' }}
                                >
                                    שינוי פרטים
                                </button>
                                <button
                                    onClick={() => setEditType('MOVE')}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: '6px', border: editType === 'MOVE' ? '2px solid #7C3AED' : '1px solid #ddd', background: editType === 'MOVE' ? '#f5f3ff' : 'white', color: editType === 'MOVE' ? '#7C3AED' : '#64748b' }}
                                >
                                    החלפת יום
                                </button>
                                <button
                                    onClick={() => setEditType('CANCEL')}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: '6px', border: editType === 'CANCEL' ? '2px solid #ef4444' : '1px solid #ddd', background: editType === 'CANCEL' ? '#fef2f2' : 'white', color: editType === 'CANCEL' ? '#ef4444' : '#64748b' }}
                                >
                                    ביטול אימון
                                </button>
                            </div>
                        </div>

                        {(editType === 'CHANGE' || editType === 'MOVE') && (
                            <>
                                {editType === 'MOVE' && (
                                    <div style={{ marginBottom: '1rem' }}>
                                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>יום חדש</label>
                                        <select
                                            value={newDay}
                                            onChange={(e) => setNewDay(e.target.value)}
                                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd' }}
                                        >
                                            <option value="">בחר יום...</option>
                                            {['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(d => (
                                                <option key={d} value={d}>{d}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>שעה חדשה</label>
                                    <input type="text" value={newTime} onChange={(e) => setNewTime(e.target.value)} placeholder="לדוגמה: 18:00-19:30" style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                                </div>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>מיקום חדש (אופציונלי)</label>
                                    {locations.length > 0 ? (
                                        <>
                                            <select
                                                value={isCustomLocation ? 'OTHER' : newLocation}
                                                onChange={(e) => {
                                                    if (e.target.value === 'OTHER') {
                                                        setIsCustomLocation(true);
                                                        setNewLocation('');
                                                    } else {
                                                        setIsCustomLocation(false);
                                                        setNewLocation(e.target.value);
                                                    }
                                                }}
                                                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd' }}
                                            >
                                                <option value="">בחר אולם...</option>
                                                {locations.map(loc => (
                                                    <option key={loc} value={loc}>{loc}</option>
                                                ))}
                                                <option value="OTHER">אחר / יצירת חדש...</option>
                                            </select>
                                            {isCustomLocation && (
                                                <input
                                                    type="text"
                                                    value={newLocation}
                                                    onChange={(e) => setNewLocation(e.target.value)}
                                                    placeholder="הקלד שם אולם חדש..."
                                                    style={{ width: '100%', marginTop: '0.5rem', padding: '0.6rem', borderRadius: '6px', border: '1px solid #BE185D', background: '#fff1f2' }}
                                                    autoFocus
                                                />
                                            )}
                                        </>
                                    ) : (
                                        <input type="text" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} placeholder="שם אולם" style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd' }} />
                                    )}
                                </div>
                            </>
                        )}

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.9rem' }}>סיבה / הערות למנהל *</label>
                            <textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={3} style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ddd' }} placeholder="חובה למלא..." />
                        </div>

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button onClick={() => setEditModalOpen(false)} style={{ flex: 1, padding: '0.8rem', borderRadius: '6px', border: 'none', background: '#f1f5f9', cursor: 'pointer' }}>ביטול</button>
                            <button onClick={submitRequest} disabled={loading} style={{ flex: 1, padding: '0.8rem', borderRadius: '6px', border: 'none', background: '#BE185D', color: 'white', fontWeight: 'bold', cursor: loading ? 'wait' : 'pointer' }}>
                                {loading ? 'שולח...' : 'שלח לאישור'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TrainerPortal;
