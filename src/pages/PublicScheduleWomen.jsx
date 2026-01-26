import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Link } from 'react-router-dom';
import '../App.css';
import { flattenScheduleData, exportToExcel, parseHeaderDate, parseTime, createICSFile, parseCellContent } from '../utils/scheduleUtils';
import LeagueGamesBanner from '../components/LeagueGamesBanner';
import HallView from '../components/HallView';
import DailyView from '../components/DailyView';

// Alias for compatibility if needed, or just use parseCellContent directly
const parseScheduleContent = parseCellContent;


// Merged Data Source (Same as Men's)
const DATA_URL = "https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0";

function PublicScheduleWomen() {
    const [data, setData] = useState([]);
    const [teams, setTeams] = useState([]); // Array of objects { label, value (unique), row, name, coach }
    const [headers, setHeaders] = useState([]);
    const [dayStart, setDayStart] = useState(1);
    const [selectedTeamId, setSelectedTeamId] = useState(''); // Stores the unique value (rowIndex or composite)
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [viewMode, setViewMode] = useState('team'); // 'team' or 'halls'



    useEffect(() => {
        const fetchData = async () => {
            if (!DATA_URL) {
                setError('טרם הוגדר קישור לגיליון.');
                setLoading(false);
                return;
            }

            try {
                // Extract ID to form CSV export URL
                const match = DATA_URL.match(/\/d\/([a-zA-Z0-9-_]+)/);
                const id = match ? match[1] : null;

                // The DATA_URL is already the CSV export URL, so no need to reconstruct it
                // const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`;
                const csvUrl = DATA_URL; // Use the provided DATA_URL directly

                const response = await fetch(csvUrl);
                if (!response.ok) throw new Error('Network response was not ok');

                const reader = response.body.getReader();
                const result = await reader.read(); // Read raw bytes
                const decoder = new TextDecoder('utf-8');
                const csv = decoder.decode(result.value); // Decode to string

                Papa.parse(csv, {
                    header: false,
                    complete: (results) => {
                        const rows = results.data;
                        let headerRowIndex = -1;

                        for (let i = 0; i < rows.length; i++) {
                            if (rows[i][0] && rows[i][0].includes('קבוצות')) {
                                headerRowIndex = i;
                                break;
                            }
                        }

                        if (headerRowIndex !== -1) {
                            const headerRow = rows[headerRowIndex];
                            const dataRows = rows.slice(headerRowIndex + 1);

                            // Dynamic Column Detection
                            const teamIndex = 0;
                            let coachIndex = headerRow.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach') || h.toLowerCase().includes('trainer')));
                            let typeIndex = headerRow.findIndex(h => h && (h.toLowerCase() === 'type' || h.includes('סוג')));
                            let dayStartIndex = headerRow.findIndex(h => h && h.includes('ראשון'));

                            // Fallbacks
                            if (dayStartIndex === -1) {
                                dayStartIndex = (coachIndex !== -1) ? coachIndex + 1 : 1;
                            }
                            setDayStart(dayStartIndex);

                            // Extract teams with unique identifiers
                            const teamObjects = [];

                            dataRows.forEach((row, rowIndex) => {
                                const name = row[teamIndex];
                                if (!name || name.trim() === '') return;

                                // Filter out Banner rows
                                if (['באנר', 'banner'].some(b => name.trim().toLowerCase().includes(b))) return;

                                const typeVal = (typeIndex !== -1 && row[typeIndex]) ? row[typeIndex].trim().toUpperCase() : 'M'; // Default to M

                                const coach = (coachIndex !== -1) ? row[coachIndex] : '';
                                // Form unique label
                                const label = coach ? `${name} - ${coach}` : name;

                                teamObjects.push({
                                    label: label,
                                    value: rowIndex.toString(), // Use rowIndex as unique ID
                                    name: name.trim(),
                                    coach: coach ? coach.trim() : '',
                                    type: typeVal,
                                    row: row
                                });
                            });

                            // Sort removed to keep sheet order
                            // teamObjects.sort((a, b) => a.name.localeCompare(b.name));

                            setHeaders(headerRow);
                            setTeams(teamObjects);
                            setData(dataRows);

                            // Set default team from Women's list
                            const womenTeams = teamObjects.filter(t => t.type === 'W');
                            if (womenTeams.length > 0) {
                                setSelectedTeamId(womenTeams[0].value);
                            }
                        } else {
                            setError('לא נמצאה שורת כותרת ("קבוצות") בגיליון.');
                        }
                        setLoading(false);
                    },
                    error: (error) => {
                        console.error('Error parsing CSV:', error);
                        setError('שגיאה בפענוח הנתונים.');
                        setLoading(false);
                    }
                });
            } catch (error) {
                console.error('Error fetching data:', error);
                setError('שגיאה בטעינת הנתונים. וודא שהגיליון ציבורי.');
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const [copySuccess, setCopySuccess] = useState('');

    const getTeamSchedule = () => {
        if (!selectedTeamId) return null;
        const teamObj = teams.find(t => t.value === selectedTeamId);
        return teamObj ? teamObj.row : null;
    };

    const getSelectedTeamName = () => {
        if (!selectedTeamId) return '';
        const teamObj = teams.find(t => t.value === selectedTeamId);
        return teamObj ? teamObj.label : '';
    };

    const schedule = getTeamSchedule();

    // Filter teams for the dropdown (Women only)
    const dropdownTeams = teams.filter(t => t.type === 'W');

    // Format text to add colons to times (e.g. 1700 -> 17:00)
    const formatTime = (text) => {
        if (!text) return text;
        // Regex to match times like 1400-1600 or just 2100
        // Looks for 4 digits where first two are 00-23 and last two are 00-59
        return text.replace(/\b([0-1][0-9]|2[0-3])([0-5][0-9])\b/g, '$1:$2');
    };

    const generateMessage = () => {
        if (!selectedTeamId || !schedule) return '';

        const teamLabel = getSelectedTeamName();
        const basketball = '\uD83C\uDFC0'; // 🏀
        const sparkles = '\u2728'; // ✨
        const muscle = '\uD83D\uDCAA'; // 💪

        let message = `${basketball} *לו"ז שבועי - ${teamLabel} (נשים)* ${basketball}\n\n`;

        headers.slice(dayStart, dayStart + 7).forEach((dayHeader, index) => {
            const parts = dayHeader.split(' ');
            const dayName = parts[0];
            const date = parts[1] || '';
            const content = schedule[dayStart + index];

            const isOffDay = !content || content.trim() === '' || content.toLowerCase().includes('xxx');

            const { time, location, status, isMatch } = parseScheduleContent(content);

            let dayContent = isOffDay ? 'מנוחה' : `${time} ${location}`;

            if (status === 'cancelled') dayContent = `❌ [בוטל] ${dayContent}`;
            if (status === 'changed') dayContent = `⚠️ [שינוי] ${dayContent}`;
            if (isMatch) dayContent = `✨ ${dayContent} ✨`;

            if (!isOffDay) {
                message += `*${dayName} ${date}*: ${dayContent}\n`;
            }
        });

        message += `\nבהצלחה! ${muscle}`;
        return message;
    };

    const shareViaWhatsApp = () => {
        const message = generateMessage();
        if (!message) return;
        const encodedMessage = encodeURIComponent(message);
        window.open(`https://api.whatsapp.com/send?text=${encodedMessage}`, '_blank');
    };

    const copyToClipboard = async () => {
        const message = generateMessage();
        if (!message) return;

        try {
            await navigator.clipboard.writeText(message);
            setCopySuccess('הועתק! ✅');
            setTimeout(() => setCopySuccess(''), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <div className="app-container" style={{ background: '#FFF0F5' }}> {/* Pinkish background override */}
            <div className="nav-overlay" style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                display: 'flex',
                gap: '10px',
                zIndex: 1000
            }}>
                <Link to="/" style={{
                    fontSize: '0.9rem',
                    textDecoration: 'none',
                    color: '#EA580C',
                    padding: '5px 10px',
                    background: 'rgba(255,255,255,0.8)',
                    borderRadius: '15px',
                    fontWeight: 'bold',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                    לגברים 👨
                </Link>
                <Link to="/admin" style={{
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                    color: 'black',
                    opacity: 0.1,
                    padding: '5px'
                }}>Admin</Link>
            </div>

            <div style={{ marginTop: '50px' }}>
                <LeagueGamesBanner />
            </div>

            <header className="header" style={{
                borderBottom: '4px solid #BE185D',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: '2rem',
                flexWrap: 'wrap-reverse' // Ensure typical responsive behavior
            }}>
                <div className="header-text" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>

                    <p className="subtitle" style={{ color: '#9D174D', marginTop: '0.5rem' }}>לו"ז אימונים שבועי</p>
                </div>
                <img
                    src="/women_logo.png"
                    alt="Maccabi Raanana Women"
                    className="women-logo-main"
                    style={{
                        borderRadius: '50%',
                        width: '140px',
                        height: '140px',
                        objectFit: 'contain',
                        border: '4px solid white',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                    }}
                />
            </header>

            {loading ? (
                <div className="loading-container">
                    <div className="bouncing-ball" style={{ backgroundColor: '#BE185D' }}></div>
                </div>
            ) : error ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#BE185D' }}>{error}</div>
            ) : (
                <>
                    <>
                        <div className="filter-section" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <select
                                className="team-select"
                                value={selectedTeamId}
                                onChange={(e) => {
                                    setSelectedTeamId(e.target.value);
                                    setViewMode('team');
                                }}
                                style={{ borderColor: '#FCE7F3', flex: 1, minWidth: '200px' }}
                            >
                                <option value="" disabled>בחר קבוצה / Select a Team</option>
                                {dropdownTeams.map((team, index) => (
                                    <option key={team.value} value={team.value}>
                                        {team.label}
                                    </option>
                                ))}
                            </select>

                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                                <button
                                    onClick={() => setViewMode(viewMode === 'halls' ? 'team' : 'halls')}
                                    style={{
                                        background: viewMode === 'halls' ? '#831843' : 'white',
                                        color: viewMode === 'halls' ? 'white' : '#831843',
                                        border: '2px solid #831843',
                                        padding: '0.6rem 1rem',
                                        borderRadius: '8px',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    {viewMode === 'halls' ? 'חזור' : '📍 לו"ז אולמות'}
                                </button>
                                <button
                                    onClick={() => setViewMode(viewMode === 'daily' ? 'team' : 'daily')}
                                    style={{
                                        background: viewMode === 'daily' ? '#831843' : 'white',
                                        color: viewMode === 'daily' ? 'white' : '#831843',
                                        border: '2px solid #831843',
                                        padding: '0.6rem 1rem',
                                        borderRadius: '8px',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    {viewMode === 'daily' ? 'חזור' : '📅 לו"ז יומי מרוכז'}
                                </button>
                            </div>
                        </div>

                        {viewMode === 'team' && selectedTeamId && (
                            <div className="actions-section">
                                <button onClick={shareViaWhatsApp} className="whatsapp-btn action-btn" style={{ background: '#25D366' }}>
                                    <span>שתף בוואטסאפ</span>
                                    <span className="btn-icon">💬</span>
                                </button>
                                {/* Copy button removed as requested */}
                                <button
                                    onClick={() => {
                                        const schedule = getTeamSchedule();
                                        if (!schedule) return;
                                        const teamName = getSelectedTeamName();

                                        const events = headers.slice(dayStart, dayStart + 7).map((dayHeader, idx) => {
                                            const content = schedule[dayStart + idx];
                                            if (!content || !content.trim() || content.includes('xxx')) return null;

                                            const { location, time, isMatch } = parseScheduleContent(content);

                                            // Parse Date and Time
                                            const date = parseHeaderDate(dayHeader);
                                            if (!date) return null;

                                            // Time parsing (assuming HH:MM-HH:MM or just HH:MM)
                                            // If range, use end time. If single, assume 1.5h? Or just 1h?
                                            // formatTime normalized it to HH:MM-HH:MM usually
                                            const timeParts = time.split('-');
                                            const startT = parseTime(timeParts[0]);
                                            const endT = timeParts[1] ? parseTime(timeParts[1]) : { h: startT.h + 1, m: startT.m + 30 }; // Default 1.5h

                                            const startDate = new Date(date);
                                            startDate.setHours(startT.h, startT.m);

                                            const endDate = new Date(date);
                                            endDate.setHours(endT.h, endT.m);

                                            return {
                                                title: `${isMatch ? '🏀 משחק' : 'אימון'} - ${teamName}`,
                                                location: location,
                                                details: `אימון קבוצת ${teamName}`,
                                                start: startDate,
                                                end: endDate
                                            };
                                        }).filter(Boolean);

                                        if (events.length > 0) {
                                            createICSFile(events, `Luaz_${teamName.replace(/\s+/g, '_')}`);
                                        } else {
                                            alert('לא נמצאו אימון לייצוא השבוע.');
                                        }
                                    }}
                                    className="action-btn"
                                    style={{ background: '#3B82F6', color: 'white' }}
                                >
                                    <span>שמור ליומן</span>
                                    <span className="btn-icon">📅</span>
                                </button>
                            </div>
                        )}

                        {viewMode === 'halls' ? (
                            <HallView
                                data={data}
                                headers={headers}
                                teams={teams}
                                dayStart={dayStart}
                            />
                        ) : viewMode === 'daily' ? (
                            <DailyView
                                data={data}
                                headers={headers}
                                teams={teams}
                                dayStart={dayStart}
                            />
                        ) : (
                            <div className="schedule-grid">
                                {schedule ? (
                                    headers.slice(dayStart, dayStart + 7).map((dayHeader, index) => {
                                        const parts = dayHeader.split(' ');
                                        const dayName = parts[0];
                                        const date = parts[1] || '';
                                        const content = schedule[dayStart + index];

                                        const isOffDay = !content ||
                                            content.trim() === '' ||
                                            content.toLowerCase().includes('xxx');

                                        const isMatch = content && content.includes('משחק');
                                        // Parse content into location and time


                                        const { location, time, status } = parseScheduleContent(content);

                                        let bg = isMatch ? '#fee2e2' : '#f3f4f6'; // Default backgrounds
                                        let border = isMatch ? '#db2777' : 'transparent';
                                        let textDecoration = 'none';
                                        let opacity = 1;

                                        if (status === 'cancelled') {
                                            bg = '#fee2e2'; // Reddish
                                            textDecoration = 'line-through';
                                            opacity = 0.6;
                                        } else if (status === 'changed') {
                                            bg = '#fef3c7'; // Yellow/Amber
                                            border = '#f59e0b';
                                        }

                                        // Request: Remove empty days from view
                                        if (isOffDay) return null;

                                        return (
                                            <div key={index} className="schedule-card" style={{
                                                background: bg,
                                                borderRight: `5px solid ${border}`,
                                                opacity: opacity
                                            }}>
                                                <div className="day-header" style={{ color: isMatch ? '#be185d' : '#1f2937' }}>
                                                    <span className="day-name">{dayName}</span>
                                                    <span className="day-date">{date}</span>
                                                </div>
                                                <div className="event-details" style={{ textDecoration }}>
                                                    {status === 'cancelled' && <div style={{ color: 'red', fontWeight: 'bold' }}>❌ בוטל</div>}
                                                    {status === 'changed' && <div style={{ color: '#d97706', fontWeight: 'bold' }}>⚠️ שינוי</div>}

                                                    {!isOffDay ? (
                                                        <>
                                                            <div className="event-time" style={{ fontSize: '1.2rem', fontWeight: '800' }}>
                                                                {time}
                                                            </div>
                                                            <div className="event-location" style={{ fontSize: '1rem' }}>
                                                                {location}
                                                            </div>
                                                            {isMatch && <div className="match-badge" style={{ color: '#be185d', fontWeight: 'bold' }}>🏀 משחק</div>}
                                                        </>
                                                    ) : (
                                                        <div className="no-event">מנוחה</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="empty-state">
                                        <h3 style={{ color: '#BE185D' }}>נא לבחור קבוצה לצפייה בלו"ז</h3>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                </>
            )}
        </div>
    );
}

export default PublicScheduleWomen;
