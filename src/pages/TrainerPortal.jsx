import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { parseCellContent } from '../utils/scheduleUtils';
import { getActiveClub } from '../clubConfig.js';
import { subscribeToPush } from '../push.js';

// Trainer devices register under "__TRAINER__:<name>" so the manager can push to all
// (prefix match) or to selected trainers (exact match).
const TRAINER_PUSH_PREFIX = '__TRAINER__:';

const TrainerPortal = () => {
    // --------------------------------------------------------------------------
    // CONFIGURATION — endpoint + data come from the active club (URL path).
    // Read the SAME live board the manager works on, so proposed-slot rows line up.
    // --------------------------------------------------------------------------
    const LIVE_SHEET_API = getActiveClub().sheetApi;
    const CSV_URL = getActiveClub().dataUrl; // live board — used for change-requests
    // Trainer schedule PROPOSALS go to the manager's planning file (its own Apps Script),
    // NOT the live board. Read its board for row alignment + write proposals to its script.
    const MANAGER_FILE_ID = '1fpbkPyUIGUn_wwdJDXf4dhwHvv5Y-KRYfnmv026Gs6w';
    const MANAGER_CSV = `https://docs.google.com/spreadsheets/d/${MANAGER_FILE_ID}/export?format=csv&gid=0`;
    const MANAGER_PROPOSE_URL = 'https://script.google.com/macros/s/AKfycbzXzCDHLFUb2jZlBwrgsxaN_4Q_IAnPaFcGL9rEtL5pLScKxwPpyaV2Xo2Yn-iOoUYB/exec';

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
    const [filterTeam, setFilterTeam] = useState(''); // requests tab filters
    const [filterDay, setFilterDay] = useState('');
    const [pushMsg2, setPushMsg2] = useState(''); // trainer push enable status
    const [pushEnabled, setPushEnabled] = useState(localStorage.getItem('trainerPushV2') === '1');

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

    // Apply a successful auth result (shared by saved-token and name+code login).
    // The token is saved on this device so the trainer stays identified next time —
    // a single shared trainer link works; first login persists identity locally.
    // Load the trainer's boards + register push (called once we know who the trainer is).
    const initTrainer = (name) => {
        fetchSchedule(name);      // live board → requests
        fetchManagerBoard(name);  // manager board → proposals
        if (localStorage.getItem('trainerPushV2') !== '1') {
            subscribeToPush(TRAINER_PUSH_PREFIX + name, LIVE_SHEET_API)
                .then((res) => { if (res && res.ok) { localStorage.setItem('trainerPushV2', '1'); setPushEnabled(true); } })
                .catch(() => {});
        }
    };

    const applyAuth = (data, skipInit) => {
        const info = { name: data.trainerName, teams: data.teams || [], color: data.color, token: data.token };
        setTrainer(info);
        if (data.token) localStorage.setItem('trainerToken', data.token);
        localStorage.setItem('trainerInfo', JSON.stringify(info)); // remembered across refreshes
        setView('dashboard');
        if (!skipInit) initTrainer(data.trainerName);
    };

    const logout = () => {
        localStorage.removeItem('trainerToken');
        localStorage.removeItem('trainerInfo');
        setTrainer(null);
        setView('login');
    };

    // Explicit (with feedback) push enable — so the trainer knows it worked and the
    // manager's broadcasts will reach this device. Registers under __TRAINER__:<name>.
    const enableTrainerPush = async () => {
        setPushMsg2('מבקש הרשאה…');
        try {
            const res = await subscribeToPush(TRAINER_PUSH_PREFIX + trainer.name, LIVE_SHEET_API);
            if (res && res.ok) { localStorage.setItem('trainerPushV2', '1'); setPushEnabled(true); setPushMsg2('✓ התראות פעילות במכשיר זה'); }
            else if (res && res.reason === 'denied') setPushMsg2('ההרשאה נדחתה — אפשר התראות בהגדרות הדפדפן ונסה שוב');
            else if (res && res.reason === 'unsupported') setPushMsg2('הדפדפן לא תומך — התקן את האפליקציה ונסה שוב');
            else setPushMsg2('שגיאה בהפעלה: ' + ((res && res.reason) || ''));
        } catch {
            setPushMsg2('שגיאה, נסה שוב');
        }
    };

    // On load: restore instantly from saved info (no login flash on refresh), then
    // re-validate the token in the background.
    useEffect(() => {
        const saved = localStorage.getItem('trainerInfo');
        if (saved) {
            try {
                const info = JSON.parse(saved);
                setTrainer(info);
                setView('dashboard');
                initTrainer(info.name);
            } catch { /* ignore */ }
        }
        const token = localStorage.getItem('trainerToken') || new URLSearchParams(window.location.search).get('t');
        if (!token) return;
        fetch(LIVE_SHEET_API, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'trainerAuth', token }),
        })
            .then((r) => r.json())
            .then((data) => {
                if (data.valid) applyAuth(data, !!saved); // skip re-init if already restored
                else if (!saved) localStorage.removeItem('trainerToken');
            })
            .catch(() => { /* offline: keep optimistic restore */ });
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

    // Parse a board CSV → the trainer's sessions, team rows (absolute sheet row),
    // day headers and halls. Used for both the live board and the manager board.
    const parseBoard = (url, trainerName, onDone) => {
        Papa.parse(url, {
            download: true,
            header: false,
            complete: (results) => {
                const rows = results.data;
                let headerRowIndex = -1;
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i][0] && rows[i][0].includes('קבוצות')) { headerRowIndex = i; break; }
                }
                if (headerRowIndex === -1) { onDone({ mySessions: [], teamRows: [], dayHdrs: [], locs: [] }); return; }

                const headers = rows[headerRowIndex];
                const dayStartIndex = headers.findIndex(h => h && h.includes('ראשון'));
                const coachIndex = headers.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach')));

                const mySessions = [];
                const locSet = new Set();
                const teamRows = [];
                const dayHdrs = [];
                for (let d = 0; d < 7; d++) {
                    const colIdx = dayStartIndex + d;
                    if (headers[colIdx]) dayHdrs.push({ name: headers[colIdx], col: colIdx + 1 });
                }

                rows.slice(headerRowIndex + 1).forEach((row, rIdx) => {
                    const teamName = row[0];
                    const coach = coachIndex !== -1 ? row[coachIndex] : '';
                    const absRow = headerRowIndex + rIdx + 2; // 1-based sheet row

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
                                    id: `${rIdx}-${colIdx}`, team: teamName, day: dayName,
                                    date: (dayName || '').split(' ')[1] || '', raw: cell,
                                    originalrow: absRow, originalcol: colIdx + 1,
                                });
                            }
                            if (dayName) days[dayName] = cell || '';
                        }
                        teamRows.push({ team: teamName || '(ללא שם)', row: absRow, days });
                    }
                });

                onDone({ mySessions, teamRows, dayHdrs, locs: Array.from(locSet).sort() });
            },
        });
    };

    const mergeLocations = (locs) => setLocations((prev) => Array.from(new Set([...prev, ...locs])).sort());

    // Requests tab → LIVE board (change-requests approve on the live file).
    const fetchSchedule = (trainerName) => {
        setLoading(true);
        parseBoard(CSV_URL, trainerName, (r) => { setSchedule(r.mySessions); mergeLocations(r.locs); setLoading(false); });
    };

    // Propose tab → MANAGER planning board (proposals write there, so rows line up).
    const fetchManagerBoard = (trainerName) => {
        parseBoard(MANAGER_CSV, trainerName, (r) => { setDayHeaders(r.dayHdrs); setMyTeamRows(r.teamRows); mergeLocations(r.locs); });
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
        if (!MANAGER_PROPOSE_URL) { setProposalMsg('הזנת לו"ז עדיין בהגדרה — בקרוב.'); return; }
        setLoading(true);
        setProposalMsg('');
        try {
            await fetch(MANAGER_PROPOSE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'proposeSlots',
                    token: trainer.token,
                    trainerName: trainer.name,
                    color: trainer.color,
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
        const inputStyle = {
            padding: '0.85rem', borderRadius: '10px', border: '1px solid #243049',
            background: '#0b1220', color: '#e8edf7', outline: 'none', fontFamily: 'inherit',
            fontSize: '0.95rem', textAlign: 'center',
        };
        return (
            <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #0d1530, #070b16 70%)', fontFamily: 'Rubik, sans-serif', padding: '1rem' }}>
                <div style={{ background: 'rgba(12,19,36,0.96)', backdropFilter: 'blur(20px)', padding: '2rem 1.6rem', borderRadius: '20px', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.08)', width: '90%', maxWidth: '360px', textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, margin: '0 auto 1rem', borderRadius: 16, background: 'linear-gradient(135deg,#ff7a18,#c2410c)', display: 'grid', placeItems: 'center', fontSize: 30, boxShadow: '0 12px 30px -10px rgba(255,122,24,0.6)' }}>🏀</div>
                    <h2 style={{ color: '#fff', margin: '0 0 0.3rem', fontSize: '1.4rem', fontWeight: 800 }}>פורטל מאמנים</h2>
                    <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 1.5rem' }}>כניסה לניהול לוח האימונים שלך</p>
                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <input
                            type="text"
                            placeholder="שם מאמן (כפי שמופיע בלוח)"
                            value={loginName}
                            onChange={(e) => setLoginName(e.target.value)}
                            style={inputStyle}
                        />
                        <input
                            type="password"
                            placeholder="קוד אישי"
                            value={loginCode}
                            onChange={(e) => setLoginCode(e.target.value)}
                            style={inputStyle}
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            style={{ background: 'linear-gradient(135deg,#ff7a18,#c2410c)', color: 'white', border: 'none', padding: '0.85rem', borderRadius: '12px', fontWeight: 800, fontFamily: 'inherit', fontSize: '1rem', cursor: loading ? 'wait' : 'pointer', marginTop: '0.3rem' }}
                        >
                            {loading ? 'מתחבר...' : 'כניסה'}
                        </button>
                    </form>
                    {error && <div style={{ color: '#f87171', marginTop: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                </div>
            </div>
        );
    }

    return (
        <div dir="rtl" style={{ fontFamily: 'Rubik, sans-serif', minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #0d1530, #070b16 60%)', color: '#e8edf7', paddingBottom: '2rem' }}>
            {/* Header */}
            <header style={{ background: 'rgba(12,19,36,0.96)', padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {trainer.color && <span style={{ width: 16, height: 16, borderRadius: 4, background: trainer.color, border: '1px solid rgba(255,255,255,0.3)' }} />}
                    שלום, {trainer.name}
                </h3>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <a href={`/${getActiveClub().slug}`} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)', color: '#cbd5e1', padding: '0.3rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', textDecoration: 'none' }}>👁️ לו"ז ההורים</a>
                    <button onClick={logout} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)', color: '#cbd5e1', padding: '0.3rem 0.8rem', borderRadius: '8px', fontSize: '0.8rem', cursor: 'pointer' }}>יציאה</button>
                </div>
            </header>

            {/* Trainer push enable — shown only until notifications are active on this device */}
            {!pushEnabled && (
            <div style={{ maxWidth: 600, margin: '0.9rem auto 0', padding: '0 1rem' }}>
                <div style={{ background: 'rgba(255,122,24,0.1)', border: '1px solid rgba(255,122,24,0.3)', borderRadius: 10, padding: '0.6rem 0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ color: pushMsg2 && !pushMsg2.startsWith('✓') ? '#fca5a5' : '#fed7aa', fontSize: '0.82rem' }}>{pushMsg2 || '🔔 הפעל התראות כדי לקבל הודעות מהמנהל'}</span>
                    <button onClick={enableTrainerPush} style={{ background: 'linear-gradient(135deg,#ff7a18,#c2410c)', color: '#fff', border: 'none', borderRadius: 8, padding: '0.4rem 0.9rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer', fontSize: '0.82rem' }}>הפעל התראות</button>
                </div>
            </div>
            )}

            {/* Tabs */}
            <div style={{ maxWidth: 600, margin: '1rem auto 0', padding: '0 1rem', display: 'flex', gap: '0.4rem' }}>
                <button onClick={() => setTab('requests')} style={{ flex: 1, padding: '0.6rem', borderRadius: '10px 10px 0 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', background: tab === 'requests' ? '#121b30' : 'rgba(255,255,255,0.05)', color: tab === 'requests' ? '#ff9d3c' : '#94a3b8' }}>האימונים שלי</button>
                <button onClick={() => setTab('propose')} style={{ flex: 1, padding: '0.6rem', borderRadius: '10px 10px 0 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', background: tab === 'propose' ? '#121b30' : 'rgba(255,255,255,0.05)', color: tab === 'propose' ? '#ff9d3c' : '#94a3b8' }}>הזנת לו&quot;ז</button>
            </div>

            {/* Schedule List */}
            {tab === 'requests' && (() => {
            const teamsList = [...new Set(schedule.map((s) => s.team))];
            const daysList = [...new Set(schedule.map((s) => s.day))];
            const filtered = schedule.filter((s) => (!filterTeam || s.team === filterTeam) && (!filterDay || s.day === filterDay));
            const selStyle = { flex: 1, minWidth: 0, padding: '0.5rem', borderRadius: 8, border: '1px solid #243049', background: '#0b1220', color: '#e8edf7', outline: 'none' };
            return (
            <div style={{ maxWidth: '600px', margin: '0 auto', padding: '1rem' }}>
                <h4 style={{ color: '#94a3b8', marginBottom: '0.8rem' }}>האימונים שלי השבוע</h4>

                {/* Filters (handy when a trainer has several teams) */}
                {schedule.length > 0 && (teamsList.length > 1 || daysList.length > 1) && (
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                        <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} style={selStyle}>
                            <option value="">כל הקבוצות</option>
                            {teamsList.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
                        </select>
                        <select value={filterDay} onChange={(e) => setFilterDay(e.target.value)} style={selStyle}>
                            <option value="">כל הימים</option>
                            {daysList.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                )}

                {loading && <div style={{ textAlign: 'center', color: '#94a3b8' }}>טוען נתונים...</div>}

                {!loading && filtered.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>לא נמצאו אימונים{(filterTeam || filterDay) ? ' לסינון הזה' : ' המשויכים אליך'}.</div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    {filtered.map(session => (
                        <div key={session.id} style={{ background: '#121b30', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#e8edf7' }}>{session.team}</div>
                                <div style={{ color: '#ff9d3c', fontWeight: '500' }}>{session.day}</div>
                                <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.2rem' }}>{session.raw}</div>
                            </div>
                            <button
                                onClick={() => handleEditClick(session)}
                                style={{
                                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '50%', width: '40px', height: '40px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: 'pointer', color: '#e8edf7'
                                }}
                            >
                                ✏️
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            );
            })()}

            {/* Propose weekly schedule (Section 5) */}
            {tab === 'propose' && (
            <div style={{ maxWidth: 600, margin: '0 auto', padding: '1rem' }}>
                <div style={{ background: 'rgba(255,122,24,0.1)', border: '1px solid rgba(255,122,24,0.3)', borderRadius: 10, padding: '0.8rem', fontSize: '0.85rem', color: '#fed7aa', marginBottom: '1rem', lineHeight: 1.6 }}>
                    מלאו את שעות ומיקומי האימונים המבוקשים. ההצעות ייכתבו ללוח המנהל <strong>בצבע שלכם</strong> ויסומנו "(הצעה)" — המנהל יאשר או ישבץ מחדש.
                </div>

                {loading && <div style={{ textAlign: 'center', color: '#94a3b8' }}>טוען...</div>}
                {!loading && myTeamRows.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>לא נמצאו קבוצות המשויכות אליך בלוח (לפי עמודת המאמן).</div>
                )}

                {myTeamRows.map((tr) => (
                    <div key={tr.row} style={{ background: '#121b30', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 'bold', color: '#e8edf7', marginBottom: '0.7rem' }}>{tr.team}</div>
                        {dayHeaders.map((dh) => {
                            const key = `${tr.row}|${dh.name}`;
                            const p = proposals[key] || {};
                            const inp = { flex: 1, minWidth: 0, padding: '0.45rem', borderRadius: 6, border: '1px solid #243049', background: '#0b1220', color: '#e8edf7', outline: 'none' };
                            const parts = (dh.name || '').split(' ');
                            const dayName = parts[0];
                            const dayDate = parts.slice(1).join(' '); // the date shown in the manager board
                            const existing = (tr.days[dh.name] || '').trim();
                            return (
                                <div key={dh.name} style={{ marginBottom: '0.7rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.3rem' }}>
                                        <span style={{ fontSize: '0.9rem', color: '#e8edf7', fontWeight: 600 }}>{dayName} <span style={{ color: '#94a3b8', fontWeight: 400 }}>{dayDate}</span></span>
                                        {existing && <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>כעת בלוח: {existing}</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                        <input value={p.time || ''} onChange={(e) => setProposal(key, 'time', e.target.value)} placeholder="שעה (לדוגמה 1800-2000)" style={inp} />
                                        <input value={p.location || ''} onChange={(e) => setProposal(key, 'location', e.target.value)} placeholder="אולם" list="hall-list" style={inp} />
                                    </div>
                                </div>
                            );
                        })}
                        <button onClick={() => submitProposals(tr)} disabled={loading} style={{ marginTop: '0.6rem', width: '100%', padding: '0.7rem', border: 'none', borderRadius: 8, background: '#ff7a18', color: 'white', fontWeight: 'bold', cursor: loading ? 'wait' : 'pointer' }}>שלח הצעות למנהל</button>
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
                <div dir="rtl" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(4,8,18,0.7)', backdropFilter: 'blur(4px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ background: '#121b30', border: '1px solid rgba(255,255,255,0.1)', color: '#e8edf7', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '1.5rem' }}>
                        <h3 style={{ marginTop: 0, color: '#fff' }}>בקשת שינוי / ביטול</h3>

                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '0.8rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.9rem', color: '#cbd5e1' }}>
                            <strong>קיים:</strong> {selectedSession?.day} - {selectedSession?.raw}
                        </div>

                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>סוג בקשה</label>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => setEditType('CHANGE')}
                                    style={{ flex: 1, padding: '0.6rem', borderRadius: '6px', border: editType === 'CHANGE' ? '2px solid #ff7a18' : '1px solid #ddd', background: editType === 'CHANGE' ? '#fff7ed' : 'white', color: editType === 'CHANGE' ? '#ff7a18' : '#64748b' }}
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
                                                    style={{ width: '100%', marginTop: '0.5rem', padding: '0.6rem', borderRadius: '6px', border: '1px solid #ff7a18', background: '#fff7ed' }}
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
                            <button onClick={() => setEditModalOpen(false)} style={{ flex: 1, padding: '0.8rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', cursor: 'pointer' }}>ביטול</button>
                            <button onClick={submitRequest} disabled={loading} style={{ flex: 1, padding: '0.8rem', borderRadius: '6px', border: 'none', background: '#ff7a18', color: 'white', fontWeight: 'bold', cursor: loading ? 'wait' : 'pointer' }}>
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
