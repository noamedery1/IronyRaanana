import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Link } from 'react-router-dom';
import '../App.css';

const DATA_URL = "https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0";

function PublicSchedule() {
    const [data, setData] = useState([]);
    const [teams, setTeams] = useState([]);
    const [headers, setHeaders] = useState([]);
    const [selectedTeam, setSelectedTeam] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await fetch(DATA_URL);
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

                            // Extract unique teams (Column A)
                            const teamList = dataRows
                                .map(row => row[0])
                                .filter(team => team && team.trim() !== '')
                                .sort();

                            setHeaders(headerRow);
                            setTeams(teamList);
                            setData(dataRows);

                            // Set default team if available
                            if (teamList.length > 0) {
                                // Default to first team
                                setSelectedTeam(teamList[0]);
                            }
                        }
                        setLoading(false);
                    },
                    error: (error) => {
                        console.error('Error parsing CSV:', error);
                        setLoading(false);
                    }
                });
            } catch (error) {
                console.error('Error fetching data:', error);
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const [copySuccess, setCopySuccess] = useState('');

    const getTeamSchedule = () => {
        if (!selectedTeam) return null;
        return data.find(row => row[0] === selectedTeam);
    };

    const schedule = getTeamSchedule();

    // Format text to add colons to times (e.g. 1700 -> 17:00)
    const formatTime = (text) => {
        if (!text) return text;
        // Regex to match times like 1400-1600 or just 2100
        // Looks for 4 digits where first two are 00-23 and last two are 00-59
        return text.replace(/\b([0-1][0-9]|2[0-3])([0-5][0-9])\b/g, '$1:$2');
    };

    const generateMessage = () => {
        if (!selectedTeam || !schedule) return '';

        const basketball = '\uD83C\uDFC0'; // 🏀
        const sparkles = '\u2728'; // ✨
        const muscle = '\uD83D\uDCAA'; // 💪

        let message = `${basketball} *לו"ז שבועי - ${selectedTeam}* ${basketball}\n\n`;

        headers.slice(1, 8).forEach((dayHeader, index) => {
            const parts = dayHeader.split(' ');
            const dayName = parts[0];
            const date = parts[1] || '';
            const content = schedule[index + 1];

            const isOffDay = !content || content.trim() === '' || content.toLowerCase().includes('xxx');
            const isMatch = content && content.includes('משחק');

            let dayContent = isOffDay ? 'מנוחה' : formatTime(content);
            if (isMatch) dayContent = `${sparkles} ${dayContent} ${sparkles}`;

            // Request: Remove empty days from message
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
        <div className="app-container">
            <div className="nav-overlay" style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                display: 'flex',
                gap: '10px',
                zIndex: 1000
            }}>
                <Link to="/women" style={{
                    fontSize: '0.9rem',
                    textDecoration: 'none',
                    color: '#BE185D',
                    padding: '5px 10px',
                    background: 'rgba(255,255,255,0.8)',
                    borderRadius: '15px',
                    fontWeight: 'bold',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}>
                    לנשים 👩
                </Link>
                <Link to="/admin" style={{
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                    color: 'black',
                    opacity: 0.1,
                    padding: '5px'
                }}>Admin</Link>
            </div>

            <header className="header" style={{
                borderBottom: '4px solid #EA580C',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: '2rem',
                flexWrap: 'wrap-reverse' // Ensure typical responsive behavior
            }}>
                <div className="header-text" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <h1 className="title" style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>עירוני רעננה</h1>
                    <h2 className="title-sub" style={{ fontSize: '1.5rem', margin: 0 }}>כדורסל - מחלקת הנוער</h2>
                    <p className="subtitle" style={{ marginTop: '0.5rem' }}>לו"ז אימונים שבועי</p>
                </div>
                <img
                    src="/men_logo.png"
                    alt="Ironi Raanana Men"
                    className="men-logo-main"
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
                    <div className="bouncing-ball"></div>
                </div>
            ) : (
                <>
                    <div className="filter-section">
                        <select
                            className="team-select"
                            value={selectedTeam}
                            onChange={(e) => setSelectedTeam(e.target.value)}
                        >
                            <option value="" disabled>בחר קבוצה / Select a Team</option>
                            {teams.map((team, index) => (
                                <option key={index} value={team}>
                                    {team}
                                </option>
                            ))}
                        </select>
                    </div>

                    {selectedTeam && (
                        <div className="actions-section">
                            <button onClick={shareViaWhatsApp} className="whatsapp-btn action-btn">
                                <span>שתף בוואטסאפ</span>
                                <span className="btn-icon">💬</span>
                            </button>
                            <button onClick={copyToClipboard} className="copy-btn action-btn">
                                <span>{copySuccess || 'העתק הודעה'}</span>
                                <span className="btn-icon">📋</span>
                            </button>
                        </div>
                    )}

                    <div className="schedule-grid">
                        {schedule ? (
                            headers.slice(1, 8).map((dayHeader, index) => {
                                const parts = dayHeader.split(' ');
                                const dayName = parts[0];
                                const date = parts[1] || '';
                                const content = schedule[index + 1];

                                const isOffDay = !content ||
                                    content.trim() === '' ||
                                    content.toLowerCase().includes('xxx');

                                const isMatch = content && content.includes('משחק');
                                // Parse content into location and time
                                const parseContent = (text) => {
                                    if (!text) return { location: '', time: '' };
                                    const formatted = formatTime(text);
                                    // Match time pattern (e.g. 17:00 or 17:00-18:30)
                                    const timeRegex = /\b\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\b/g;
                                    const matches = formatted.match(timeRegex);

                                    if (matches && matches.length > 0) {
                                        // Take the last match as the time (usually at the end)
                                        const timePart = matches[matches.length - 1];
                                        // Remove ALL time matches from location to be clean
                                        let locationPart = formatted;
                                        matches.forEach(m => {
                                            locationPart = locationPart.replace(m, '');
                                        });
                                        return { location: locationPart.trim(), time: timePart };
                                    }
                                    return { location: formatted, time: '' };
                                };

                                const { location, time } = parseContent(content);

                                // Request: Remove empty days from view
                                if (isOffDay) return null;

                                return (
                                    <div key={index} className={`day-card ${isMatch ? 'match-day' : ''}`} style={{ opacity: isOffDay ? 0.6 : 1 }}>
                                        <div className="day-header">
                                            <span className="day-name">{dayName}</span>
                                            <span className="day-date">{date}</span>
                                        </div>
                                        <div className={`day-content ${isOffDay ? 'empty-day' : ''}`}>
                                            {isOffDay ? 'מנוחה' : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', width: '100%' }}>
                                                    {isMatch && <div className="match-badge">🏀 משחק</div>}
                                                    <div className="location-text" style={{ fontSize: '1.2rem', fontWeight: '700', color: isMatch ? '#ea580c' : '#1e293b' }}>
                                                        {location}
                                                    </div>
                                                    {time && (
                                                        <div className="time-text" style={{ fontSize: '1.1rem', color: '#64748b', fontWeight: '500', direction: 'ltr' }}>
                                                            {time}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="empty-state">
                                <h3>נא לבחור קבוצה לצפייה בלו"ז</h3>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

export default PublicSchedule;
