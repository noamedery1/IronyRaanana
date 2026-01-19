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

            message += `*${dayName} ${date}*: ${dayContent}\n`;
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
            <Link to="/admin" className="admin-link-overlay" style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                opacity: 0.1,
                fontSize: '0.8rem',
                textDecoration: 'none',
                color: 'black',
                pointerEvents: 'all'
            }}>Admin</Link>

            <header className="header">
                <img src="/hoop_v2.png" alt="Basket Hoop" className="hoop-icon" />
                <div className="header-text">
                    <h1 className="title">עירוני רעננה</h1>
                    <h2 className="title-sub">כדורסל - מחלקת הנוער</h2>
                    <p className="subtitle">לו"ז אימונים שבועי</p>
                </div>
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
                                const displayContent = isOffDay ? 'מנוחה' : formatTime(content);

                                return (
                                    <div key={index} className={`day-card ${isMatch ? 'match-day' : ''}`} style={{ opacity: isOffDay ? 0.6 : 1 }}>
                                        <div className="day-header">
                                            <span className="day-name">{dayName}</span>
                                            <span className="day-date">{date}</span>
                                        </div>
                                        <div className={`day-content ${isOffDay ? 'empty-day' : ''}`}>
                                            {isOffDay ? 'מנוחה' : (
                                                isMatch ? (
                                                    <div className="match-content">
                                                        <span className="match-icon">🏀</span>
                                                        <span>{displayContent}</span>
                                                    </div>
                                                ) : displayContent
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
