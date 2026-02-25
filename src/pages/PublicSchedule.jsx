import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Link } from 'react-router-dom';
import '../App.css';
import { flattenScheduleData, exportToExcel, parseHeaderDate, parseTime, createICSFile, parseCellContent } from '../utils/scheduleUtils';
import LeagueGamesBanner from '../components/LeagueGamesBanner';
import HallView from '../components/HallView';
import DailyView from '../components/DailyView';
import TrainerEditModal from '../components/TrainerEditModal'; // Import the Modal
import RegisterUpdatesModal from '../components/RegisterUpdatesModal';

// Alias for compatibility if needed, or just use parseCellContent directly
const parseScheduleContent = parseCellContent;

// This URL should be the LIVE sheet's Web App URL
const LIVE_SHEET_API = "https://script.google.com/macros/s/AKfycbxGQADUyjdb9khg5Txi8EmZCT-RsIhVSbf1j_XGMpTYbvnkJak-BUv6UV0a5K9a-Yg/exec";
const DATA_URL = "https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0";

function PublicSchedule() {
    const [locations, setLocations] = useState([]); // Store active halls for dropdown
    const [data, setData] = useState([]);
    const [teams, setTeams] = useState([]); // Array of objects
    const [headers, setHeaders] = useState([]);
    const [dayStart, setDayStart] = useState(1);

    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('team'); // 'team' or 'halls'
    const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedSessionForEdit, setSelectedSessionForEdit] = useState(null);

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

                            // Dynamic Column Detection
                            const teamIndex = 0;
                            let coachIndex = headerRow.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach') || h.toLowerCase().includes('trainer')));
                            let typeIndex = headerRow.findIndex(h => h && (h.toLowerCase() === 'type' || h.includes('סוג'))); // Exact match preferred for 'type'
                            let dayStartIndex = headerRow.findIndex(h => h && h.includes('ראשון'));

                            // Fallbacks
                            if (dayStartIndex === -1) {
                                dayStartIndex = (coachIndex !== -1) ? coachIndex + 1 : 1;
                            }
                            setDayStart(dayStartIndex);

                            // Extract Halls
                            const locSet = new Set();
                            dataRows.forEach(r => {
                                for (let d = dayStartIndex; d < dayStartIndex + 7; d++) {
                                    const c = r[d];
                                    if (c && c.trim() && !c.toLowerCase().includes('xxx')) {
                                        const parts = c.split('\n');
                                        parts.forEach(p => {
                                            const { location } = parseCellContent(p);
                                            if (location && location.trim().length > 1) locSet.add(location.trim());
                                        });
                                    }
                                }
                            });
                            setLocations(Array.from(locSet).sort());


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

                                // Calculate absolute row index (1-based for Sheet)
                                // headerRowIndex is the 0-based index of header in 'rows'
                                // dataRows start at headerRowIndex + 1
                                // current row in dataRows is rowIndex
                                // So row in 'rows' is headerRowIndex + 1 + rowIndex
                                // Sheet Row is 1-based, so +1 again => headerRowIndex + 2 + rowIndex
                                const absoluteRow = headerRowIndex + 2 + rowIndex;

                                teamObjects.push({
                                    label: label,
                                    value: rowIndex.toString(), // Keep using rowIndex for internal value if needed, or switch to absolute? Let's use rowIndex for state but store absoluteRow for edits.
                                    name: name.trim(),
                                    coach: coach ? coach.trim() : '',
                                    type: typeVal,
                                    row: row,
                                    rowIndex: rowIndex,
                                    absoluteRow: absoluteRow // STORE THIS
                                });
                            });

                            setHeaders(headerRow);
                            setTeams(teamObjects);
                            setData(dataRows);

                            // Set default team from Men's list if available
                            // Set default team from Men's list if available
                            const menTeams = teamObjects.filter(t => t.type !== 'W');

                            // Check URL Params for deep linking
                            const urlParams = new URLSearchParams(window.location.search);
                            const sharedTeam = urlParams.get('team');
                            let defaultTeamId = '';

                            if (sharedTeam) {
                                const found = teamObjects.find(t => t.label === sharedTeam || t.name === sharedTeam);
                                if (found) defaultTeamId = found.value;
                            }

                            if (!defaultTeamId && menTeams.length > 0) {
                                defaultTeamId = menTeams[0].value;
                            }

                            setSelectedTeamId(defaultTeamId);
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

    const getTeamObj = () => {
        if (!selectedTeamId) return null;
        return teams.find(t => t.value === selectedTeamId);
    };

    const getSelectedTeamName = () => {
        const t = getTeamObj();
        return t ? t.label : '';
    };

    // Helper to open edit modal
    // Helper to open edit modal
    const handleEditSession = (content, dayHeader, colIndex) => {
        const teamObj = getTeamObj();
        if (!teamObj) return;

        const { time, location } = parseScheduleContent(content);
        const dayName = dayHeader.split(' ')[0];

        // Use the absolute row index we calculated (Sheet 1-based Row)
        // This fixes the issue where edits were writing to the header row
        const row = teamObj.absoluteRow;

        setSelectedSessionForEdit({
            team: teamObj.label,
            coach: teamObj.coach,
            day: dayName,
            time: time,
            location: location,
            raw: content,
            row: row, // Pass absolute row
            col: colIndex // 0-based column index
        });
        setIsEditModalOpen(true);
    };

    const schedule = getTeamObj() ? getTeamObj().row : null;
    const dropdownTeams = teams.filter(t => t.type !== 'W');

    // ... (rest of helpers like formatTime, match detection logic embedded in render) ...
    // Simplified specific helpers for render

    // ...

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
                {/* Trainer Link Removed - Integrated into Edit Buttons */}
                <Link to="/admin" style={{
                    fontSize: '0.8rem',
                    textDecoration: 'none',
                    color: 'black',
                    opacity: 0.1,
                    padding: '5px'
                }}>Admin</Link>
            </div>

            <div style={{ marginTop: '50px' }}>
                <LeagueGamesBanner data={data} headers={headers} targetGender="M" />
            </div>

            <header className="header" style={{
                borderBottom: '4px solid #EA580C',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: '2rem',
                flexWrap: 'wrap-reverse'
            }}>
                <div className="header-text" style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
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
                    <>
                        <div className="filter-section" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <select
                                className="team-select"
                                value={selectedTeamId}
                                onChange={(e) => {
                                    setSelectedTeamId(e.target.value);
                                    setViewMode('team');
                                }}
                                style={{ flex: 1, minWidth: '200px' }}
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
                                        background: viewMode === 'halls' ? '#ea580c' : 'white',
                                        color: viewMode === 'halls' ? 'white' : '#ea580c',
                                        border: '2px solid #ea580c',
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
                                        background: viewMode === 'daily' ? '#ea580c' : 'white',
                                        color: viewMode === 'daily' ? 'white' : '#ea580c',
                                        border: '2px solid #ea580c',
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
                                <button
                                    onClick={() => setIsRegisterModalOpen(true)}
                                    className="action-btn"
                                    style={{ background: '#EA580C', color: 'white' }}
                                >
                                    <span>עידכונים</span>
                                    <span className="btn-icon">🔔</span>
                                </button>
                                <button onClick={() => {
                                    const teamName = getSelectedTeamName();
                                    const teamObj = getTeamObj();
                                    if (!teamObj) return;

                                    const schedule = teamObj.row;
                                    const basketball = '\uD83C\uDFC0';
                                    const muscle = '\uD83D\uDCAA';

                                    let message = `${basketball} *לו"ז שבועי - ${teamName}* ${basketball}\n\n`;

                                    headers.slice(dayStart, dayStart + 7).forEach((dayHeader, index) => {
                                        const parts = dayHeader.split(' ');
                                        const dayName = parts[0];
                                        const date = parts[1] || '';
                                        const content = schedule[dayStart + index];

                                        if (!content || !content.trim() || content.toLowerCase().includes('xxx')) return; // Skip off days

                                        const lines = content.split('\n');

                                        lines.forEach(line => {
                                            if (!line.trim()) return;
                                            const { time, location, status, isMatch } = parseScheduleContent(line);

                                            let dayContent = `${time} ${location}`;

                                            if (status === 'cancelled') dayContent = `❌ [בוטל] ${dayContent}`;
                                            if (status === 'changed') dayContent = `⚠️ [שינוי] ${dayContent}`;
                                            if (isMatch) dayContent = `🎆 *משחק ${dayContent}* 🎆`;

                                            message += `${dayName} ${date}: ${dayContent}\n`;
                                        });
                                    });

                                    // Generate Deep Link
                                    // Use minimal encoding for "prettier" link (keep Hebrew chars, only encode special chars)
                                    // WhatsApp handles IRIs (Hebrew URLs) well if spaces are encoded.
                                    const baseUrl = `${window.location.origin}${window.location.pathname}`;
                                    // Manually encode only spaces and critical chars if we want "pretty" looking Hebrew
                                    // But safest "pretty" way is to let the browser encoded it when clicked, 
                                    // so we provide a link that LOOKS readable.
                                    // However, simpler is just using the URL API which encodes.
                                    // User specifically complained about %D7...
                                    // Let's try to construct a string with Hebrew characters and %20 for spaces.
                                    const safeTeamParam = teamName
                                        .replace(/%/g, '%25')
                                        .replace(/&/g, '%26')
                                        .replace(/\+/g, '%2B')
                                        .replace(/#/g, '%23')
                                        .replace(/\?/g, '%3F')
                                        .replace(/=/g, '%3D')
                                        .replace(/ /g, '%20');
                                    const link = `${baseUrl}?team=${safeTeamParam}`;

                                    // Ensure link is on a new line to be clickable
                                    message += `\nלצפייה בלו"ז המלא:\n${link}\n\nבהצלחה! ${muscle}`;

                                    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank');
                                }} className="whatsapp-btn action-btn">
                                    <span>שתף בוואטסאפ</span>
                                    <span className="btn-icon">💬</span>
                                </button>

                                <button
                                    onClick={() => {
                                        const schedule = getTeamObj()?.row;
                                        if (!schedule) return;
                                        const teamName = getSelectedTeamName();
                                        const events = headers.slice(dayStart, dayStart + 7).map((dayHeader, idx) => {
                                            const content = schedule[dayStart + idx];
                                            if (!content || !content.trim() || content.includes('xxx')) return null;
                                            const { location, time, isMatch } = parseScheduleContent(content);
                                            const date = parseHeaderDate(dayHeader);
                                            if (!date) return null;
                                            const timeParts = time.split('-');
                                            const startT = parseTime(timeParts[0]);
                                            const endT = timeParts[1] ? parseTime(timeParts[1]) : { h: startT.h + 1, m: startT.m + 30 };
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
                                defaultGender="M"
                            />
                        ) : viewMode === 'daily' ? (
                            <DailyView
                                data={data}
                                headers={headers}
                                teams={teams}
                                dayStart={dayStart}
                                defaultGender="M"
                            />
                        ) : (

                            <div className="schedule-grid">
                                {schedule ? (
                                    headers.slice(dayStart, dayStart + 7).map((dayHeader, index) => {
                                        const parts = dayHeader.split(' ');
                                        const dayName = parts[0];
                                        const date = parts[1] || '';
                                        const colIndex = dayStart + index;
                                        const content = schedule[colIndex];

                                        const isOffDay = !content ||
                                            content.trim() === '' ||
                                            content.toLowerCase().includes('xxx');

                                        const isMatch = content && (content.includes('משחק') || content.includes('🏀'));

                                        // Split content by newline
                                        const lines = content ? content.split('\n').filter(l => l.trim().length > 0) : [];

                                        // Determine overall card style based on first event or if any match exists?
                                        // Let's keep it simple: if any event is a match on this day, color it match?
                                        // Or just use neutral unless ALL are matches?
                                        // For now, let's stick to the first event defining the "Day Card" style, or just separate items inside.

                                        const anyMatch = lines.some(l => l.includes('משחק') || l.includes('🏀'));
                                        const anyCancelled = lines.every(l => l.match(/x|בוטל|canceled|cancelled/i));

                                        let bg = anyMatch ? '#fee2e2' : '#f3f4f6';
                                        let border = anyMatch ? '#ef4444' : 'transparent';
                                        let opacity = 1;

                                        if (anyCancelled) {
                                            bg = '#fee2e2';
                                            opacity = 0.6;
                                        } else if (lines.some(l => l.includes('!') || l.includes('⚠️'))) {
                                            bg = '#fef3c7';
                                            border = '#f59e0b';
                                        }

                                        if (isOffDay) return null;

                                        return (
                                            <div key={index} className="schedule-card" style={{
                                                background: bg,
                                                borderRight: `5px solid ${border}`,
                                                opacity: opacity,
                                                position: 'relative'
                                            }}>
                                                {/* Edit Button - Only visible if not cancelled? Or always allow edits to restore/change? Always. */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleEditSession(content, dayHeader, colIndex);
                                                    }}
                                                    style={{
                                                        position: 'absolute',
                                                        bottom: '5px', // Moved to bottom to avoid date overlap
                                                        left: '5px',
                                                        background: 'white',
                                                        border: '1px solid #ddd',
                                                        borderRadius: '50%',
                                                        width: '24px',
                                                        height: '24px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        cursor: 'pointer',
                                                        fontSize: '12px',
                                                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                                        zIndex: 10
                                                    }}
                                                    title="עריכת מאמן"
                                                >
                                                    ✏️
                                                </button>

                                                <div className="day-header" style={{ color: anyMatch ? '#b91c1c' : '#1f2937' }}>
                                                    <span className="day-name">{dayName}</span>
                                                    <span className="day-date">{date}</span>
                                                </div>
                                                <div className="events-container" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {lines.map((line, lIdx) => {
                                                        const { location, time, status, isMatch } = parseScheduleContent(line);
                                                        const isCancelled = status === 'cancelled';
                                                        const isChanged = status === 'changed';

                                                        return (
                                                            <div key={lIdx} className="event-item" style={{
                                                                textDecoration: isCancelled ? 'line-through' : 'none',
                                                                borderBottom: lIdx < lines.length - 1 ? '1px solid rgba(0,0,0,0.1)' : 'none',
                                                                paddingBottom: lIdx < lines.length - 1 ? '4px' : '0'
                                                            }}>
                                                                {isCancelled && <div style={{ color: 'red', fontWeight: 'bold', fontSize: '0.8rem' }}>❌ בוטל</div>}
                                                                {isChanged && <div style={{ color: '#d97706', fontWeight: 'bold', fontSize: '0.8rem' }}>⚠️ שינוי</div>}

                                                                <div className="event-time" style={{ fontSize: '1.2rem', fontWeight: '800' }}>{time}</div>
                                                                <div className="event-location" style={{ fontSize: '1rem' }}>{location}</div>
                                                                {isMatch && <div className="match-badge">🏀 משחק</div>}
                                                            </div>
                                                        );
                                                    })}
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
                        )}
                    </>
                </>
            )
            }

            <TrainerEditModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                sessionData={selectedSessionForEdit}
                sheetUrl={LIVE_SHEET_API}
                availableLocations={locations}
            />

            <RegisterUpdatesModal
                isOpen={isRegisterModalOpen}
                onClose={() => setIsRegisterModalOpen(false)}
                teamName={getSelectedTeamName()}
                sheetUrl={LIVE_SHEET_API}
            />
        </div >
    );
}

export default PublicSchedule;
