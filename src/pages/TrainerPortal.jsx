import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { parseCellContent } from '../utils/scheduleUtils';
import { getActiveClub } from '../clubConfig.js';

const TrainerPortal = () => {
    // --------------------------------------------------------------------------
    // CONFIGURATION — endpoint + data come from the active club (URL path).
    // Read the SAME live board the manager works on, so proposed-slot rows line up.
    // --------------------------------------------------------------------------
    const LIVE_SHEET_API = getActiveClub().sheetApi;
    const CSV_URL = getActiveClub().dataUrl;

    // --------------------------------------------------------------------------
    // STATE
    // --------------------------------------------------------------------------
    const [view, setView] = useState('login'); // 'login', 'dashboard'
    const [trainer, setTrainer] = useState(null); // { name, teams, color, token }
    const [schedule, setSchedule] = useState([]);
    const [locations, setLocations] = useState([]); // Available halls
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Section 5: proposing a weekly schedule directly into the manager's board.
    const [dayHeaders, setDayHeaders] = useState([]); // [{name, col}] for the 7 days
    const [myTeamRows, setMyTeamRows] = useState([]); // [{team, row, days:{dayName:value}}]
    const [proposals, setProposals] = useState({}); // { "row|dayName": {time, location} }
    const [proposalMsg, setProposalMsg] = useState('');
    const [tab, setTab] = useState('requests'); // 'requests' | 'propose'

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

    // Apply a successful auth result (shared by token-link and name+code login).
    const applyAuth = (data) => {
        setTrainer({ name: data.trainerName, teams: data.teams || [], color: data.color, token: data.token });
        setView('dashboard');
        fetchSchedule(data.trainerName);
    };

    // Personal-link login: /trainer?t=<token>
    useEffect(() => {
        const token = new URLSearchParams(window.location.search).get('t');
        if (!token) return;
        setLoading(true);
        fetch(LIVE_SHEET_API, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'trainerAuth', token }),
        })
            .then((r) => r.json())
            .then((data) => { if (data.valid) applyAuth(data); })
            .catch(() => { /* fall back to manual login */ })
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const result = await fetch(LIVE_SHEET_API, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 'text/plain' avoids CORS preflight
                body: JSON.stringify({ action: 'trainerAuth', name: loginName, code: loginCode }),
            });
            const data = await result.json();
            if (data.valid) applyAuth(data);
            else setError('שם משתמש או קוד שגוי');
        } catch (err) {
            console.error('Login Error', err);
            setError('שגיאת תקשורת או פרטים שגויים. וודא שהסקריפט מעודכן.');
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
                const teamRows = [];

                // The 7 day headers (name + 1-based column) for the proposal grid.
                const dayHdrs = [];
                for (let d = 0; d < 7; d++) {
                    const colIdx = dayStartIndex + d;
                    if (headers[colIdx]) dayHdrs.push({ name: headers[colIdx], col: colIdx + 1 });
                }

                rows.slice(headerRowIndex + 1).forEach((row, rIdx) => {
                    const teamName = row[0];
                    const coach = coachIndex !== -1 ? row[coachIndex] : '';
                    const absRow = headerRowIndex + rIdx + 2; // 1-based sheet row (header at headerRowIndex)

                    // Collect Locations from all valid cells
                    for (let d = 0; d < 7; d++) {
                        const colIdx = dayStartIndex + d;
                        const cell = row[colIdx];
                        if (cell && cell.trim() && !cell.toLowerCase().includes('xxx')) {
                            const { location } = parseCellContent(cell);
                            if (location && location.trim().length > 1) locSet.add(location.trim());
                        }
                    }

                    const isMyCoach = coach && coach.trim().toLowerCase() === trainerName.toLowerCase();

                    if (isMyCoach) {
                        const days = {};
                        for (let d = 0; d < 7; d++) {
                            const colIdx = dayStartIndex + d;
                            const cell = row[colIdx];
                            const dayName = headers[colIdx];
                            if (cell && cell.trim()) {
                                mySessions.push({
                                    id: `${rIdx}-${colIdx}`,
                                    team: teamName,
                                    day: dayName,
                                    date: (dayName || '').split(' ')[1] || '',
                                    raw: cell,
                                    originalrow: absRow, // absolute 1-based sheet row
                                    originalcol: colIdx + 1
                                });
                            }
                            if (dayName) days[dayName] = cell || '';
                        }
                        teamRows.push({ team: teamName || '(ללא שם)', row: absRow, days });
                    }
                });

                setLocations(Array.from(locSet).sort());
                setSchedule(mySessions);
                setDayHeaders(dayHdrs);
                setMyTeamRows(teamRows);
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

    const setProposal = (rowKey, field, value) => {
        setProposals((p) => ({ ...p, [rowKey]: { ...(p[rowKey] || {}), [field]: value } }));
    };

    const submitProposals = async (teamRow) => {
        const slots = dayHeaders
            .map((dh) => {
                const p = proposals[`${teamRow.row}|${dh.name}`] || {};
                return { day: dh.name, time: (p.time || '').trim(), location: (p.location || '').trim() };
            })
            .filter((s) => s.time);
        if (!slots.length) { setProposalMsg('מלא לפחות יום אחד עם שעה.'); return; }
        setLoading(true);
        setProposalMsg('');
        try {
            await fetch(LIVE_SHEET_API, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'proposeSlots',
                    token: trainer.token,
                    trainerName: trainer.name,
                    row: teamRow.row,
                    slots,
                }),
            });
            setProposalMsg(`✓ נשלחו ${slots.length} הצעות למנהל עבור ${teamRow.team}. ימתינו לאישורו בלוח.`);
        } catch (err) {
            console.error(err);
            setProposalMsg('שגיאה בשליחה, נסה שוב.');
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
                    <h2 style={{ color: '#BE185D', marginBottom: '1.5rem' }}>פורטל מאמנים</h2>
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
                <h3 style={{ margin: 0, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {trainer.color && <span style={{ width: 16, height: 16, borderRadius: 4, background: trainer.color, border: '1px solid #cbd5e1' }} />}
                    שלום, {trainer.name}
                </h3>
                <button onClick={() => setView('login')} style={{ background: 'none', border: '1px solid #cbd5e1', padding: '0.3rem 0.8rem', borderRadius: '4px', fontSize: '0.8rem' }}>יציאה</button>
            </header>

            {/* Tabs */}
            <div style={{ maxWidth: 600, margin: '1rem auto 0', padding: '0 1rem', display: 'flex', gap: '0.4rem' }}>
                <button onClick={() => setTab('requests')} style={{ flex: 1, padding: '0.6rem', borderRadius: '10px 10px 0 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', background: tab === 'requests' ? 'white' : '#e2e8f0', color: tab === 'requests' ? '#BE185D' : '#64748b' }}>האימונים שלי</button>
                <button onClick={() => setTab('propose')} style={{ flex: 1, padding: '0.6rem', borderRadius: '10px 10px 0 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', background: tab === 'propose' ? 'white' : '#e2e8f0', color: tab === 'propose' ? '#BE185D' : '#64748b' }}>הזנת לו&quot;ז</button>
            </div>

            {/* Schedule List */}
            {tab === 'requests' && (
            <div style={{ maxWidth: '600px', margin: '0 auto', padding: '1rem' }}>
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
            )}

            {/* Propose weekly schedule (Section 5) */}
            {tab === 'propose' && (
            <div style={{ maxWidth: 600, margin: '0 auto', padding: '1rem' }}>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '0.8rem', fontSize: '0.85rem', color: '#1e3a8a', marginBottom: '1rem', lineHeight: 1.6 }}>
                    מלאו את שעות ומיקומי האימונים המבוקשים. ההצעות ייכתבו ללוח המנהל <strong>בצבע שלכם</strong> ויסומנו "(הצעה)" — המנהל יאשר או ישבץ מחדש.
                </div>

                {loading && <div style={{ textAlign: 'center' }}>טוען...</div>}
                {!loading && myTeamRows.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>לא נמצאו קבוצות המשויכות אליך בלוח (לפי עמודת המאמן).</div>
                )}

                {myTeamRows.map((tr) => (
                    <div key={tr.row} style={{ background: 'white', borderRadius: 10, padding: '1rem', marginBottom: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                        <div style={{ fontWeight: 'bold', color: '#334155', marginBottom: '0.7rem' }}>{tr.team}</div>
                        {dayHeaders.map((dh) => {
                            const key = `${tr.row}|${dh.name}`;
                            const p = proposals[key] || {};
                            return (
                                <div key={dh.name} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <div style={{ width: 60, fontSize: '0.85rem', color: '#64748b', flexShrink: 0 }}>{(dh.name || '').split(' ')[0]}</div>
                                    <input value={p.time || ''} onChange={(e) => setProposal(key, 'time', e.target.value)} placeholder={tr.days[dh.name] ? 'קיים: ' + tr.days[dh.name] : 'שעה'} style={{ flex: 1, minWidth: 0, padding: '0.45rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                                    <input value={p.location || ''} onChange={(e) => setProposal(key, 'location', e.target.value)} placeholder="אולם" list="hall-list" style={{ flex: 1, minWidth: 0, padding: '0.45rem', borderRadius: 6, border: '1px solid #cbd5e1' }} />
                                </div>
                            );
                        })}
                        <button onClick={() => submitProposals(tr)} disabled={loading} style={{ marginTop: '0.6rem', width: '100%', padding: '0.7rem', border: 'none', borderRadius: 8, background: '#BE185D', color: 'white', fontWeight: 'bold', cursor: loading ? 'wait' : 'pointer' }}>שלח הצעות למנהל</button>
                    </div>
                ))}

                <datalist id="hall-list">
                    {locations.map((loc) => <option key={loc} value={loc} />)}
                </datalist>

                {proposalMsg && <div style={{ textAlign: 'center', marginTop: '0.5rem', color: proposalMsg.startsWith('✓') ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>{proposalMsg}</div>}
            </div>
            )}

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
