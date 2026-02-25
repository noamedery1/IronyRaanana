import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import WeekBuilder from '../components/WeekBuilder';
import Preview from '../components/Preview';

const AdminDashboard = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('setup');

    // Setup state
    const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1fpbkPyUIGUn_wwdJDXf4dhwHvv5Y-KRYfnmv026Gs6w/edit?usp=sharing');
    const [saveUrl, setSaveUrl] = useState('https://script.google.com/macros/s/AKfycbwYvRj8HoUzqrOcteCiqRQFGAKsrU4unmv5WZm4OujxmncI5epkO32FjtVFvG2XNLw/exec');
    const [sheetName, setSheetName] = useState('גיליון1');
    const [isConnected, setIsConnected] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sheetData, setSheetData] = useState({
        headers: [],
        teams: [],
        rawRows: []
    });
    const [teamConfig, setTeamConfig] = useState([]);
    const [currentSchedule, setCurrentSchedule] = useState(null);

    // Load saved rules on mount
    useEffect(() => {
        const savedConfig = localStorage.getItem('teamRulesConfig');
        if (savedConfig) {
            try {
                const parsed = JSON.parse(savedConfig);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setTeamConfig(parsed);
                }
            } catch (e) {
                console.error("Failed to load saved rules", e);
            }
        }
    }, []);

    // Save rules on change
    useEffect(() => {
        if (teamConfig.length > 0) {
            localStorage.setItem('teamRulesConfig', JSON.stringify(teamConfig));
        }
    }, [teamConfig]);

    const handleLogout = () => {
        localStorage.removeItem('isAdmin');
        navigate('/admin');
    };

    const handleClearRules = () => {
        if (window.confirm("Are you sure you want to clear all saved rules (constraints)?")) {
            setTeamConfig([]);
            localStorage.removeItem('teamRulesConfig');
            alert("Rules cleared. Re-connect to sheet to reset.");
        }
    };

    const extractSheetId = (url) => {
        const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    };

    const loadRulesFromCloud = async () => {
        if (!saveUrl) return null;
        try {
            // Fetch from script with GET parameter
            const response = await fetch(`${saveUrl}?sheet=SavedRules`);
            if (!response.ok) return null;
            const data = await response.json();

            // Expecting array of arrays: [[Team, Coach, ConfigJSON], ...]
            if (Array.isArray(data) && data.length > 0) {
                const rulesMap = {};
                data.forEach(row => {
                    // skip header if strictly "Team"
                    if (row[0] === 'Team' && row[2] === 'Config') return;

                    try {
                        if (row[2]) { // The JSON config
                            const config = JSON.parse(row[2]);
                            const key = `${row[0]}_${row[1] || ''}`;
                            rulesMap[key] = config;
                        }
                    } catch (e) {
                        // ignore parse error for row
                    }
                });
                return rulesMap;
            }
        } catch (e) {
            console.warn("Could not load rules from cloud:", e);
        }
        return null;
    };

    const saveRulesToCloud = async (currentConfig) => {
        if (!saveUrl || !currentConfig) return;

        const rows = [['Team', 'Coach', 'Config']];
        currentConfig.forEach(t => {
            rows.push([t.name, t.coach, JSON.stringify(t)]);
        });

        const payload = {
            sheetName: 'SavedRules',
            rows: rows
        };

        try {
            await fetch(saveUrl, {
                method: 'POST',
                mode: 'no-cors',
                cache: 'no-cache',
                redirect: 'follow',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8',
                },
                body: JSON.stringify(payload)
            });
            alert('החוקים נשמרו בגיליון SavedRules בהצלחה!');
        } catch (e) {
            console.error("Save rules error:", e);
            alert('שגיאה בשמירת החוקים לענן.');
        }
    };

    const handleConnect = async () => {
        setLoading(true);
        setError('');
        setIsConnected(false);

        // 1. Try to load rules from Cloud first
        let cloudRulesMap = null;
        try {
            cloudRulesMap = await loadRulesFromCloud();
            if (cloudRulesMap) {
                console.log("Loaded rules from cloud:", Object.keys(cloudRulesMap).length);
            }
        } catch (e) {
            console.log("No cloud rules or error loading them");
        }

        const id = extractSheetId(sheetUrl);
        if (!id) {
            setError('Invalid Google Sheet URL. Could not find Sheet ID.');
            setLoading(false);
            return;
        }

        const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`;

        try {
            const response = await fetch(csvUrl);
            if (!response.ok) {
                throw new Error('Failed to fetch Google Sheet. Make sure it is public or shared.');
            }

            const reader = response.body.getReader();
            const result = await reader.read();
            const decoder = new TextDecoder('utf-8');
            const csv = decoder.decode(result.value);

            Papa.parse(csv, {
                header: false,
                complete: (results) => {
                    const rows = results.data;
                    let headerRowIndex = -1;

                    // Find header row containing "קבוצות"
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
                        const teamIndex = 0; // Always A
                        let coachIndex = headerRow.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach') || h.toLowerCase().includes('trainer')));
                        let typeIndex = headerRow.findIndex(h => h && (h.toLowerCase() === 'type' || h.toLowerCase() === 'gender' || h.includes('סוג') || h.includes('מגדר')));
                        let dayStartIndex = headerRow.findIndex(h => h && h.includes('ראשון'));

                        // Fallbacks if detection fails
                        if (dayStartIndex === -1) {
                            // If coach found at 1, days probably start at 2. If no coach, maybe 1.
                            dayStartIndex = (coachIndex !== -1) ? coachIndex + 1 : 1;
                        }

                        // Extract unique teams (handling same name different coach)
                        // We create an object for each team row
                        const uniqueTeams = [];
                        const seenKeys = new Set();

                        dataRows.forEach((row, rowIndex) => {
                            const name = row[teamIndex];
                            if (!name || name.trim() === '') return;

                            // Filter out Banner rows
                            if (['באנר', 'banner'].some(b => name.trim().toLowerCase().includes(b))) return;

                            // We now include ALL teams (Men + Women) to manage conflicts together.
                            // The "Type" column tells us which is which. 
                            // Normalize diverse inputs (English/Hebrew) to 'M' or 'W'
                            let rawType = (typeIndex !== -1 && row[typeIndex]) ? row[typeIndex].trim() : '';
                            let typeVal = 'M'; // Default
                            const womenKeywords = ['w', 'woman', 'women', 'female', 'ladies', 'girl', 'girls', 'נשים', 'ילדות', 'נערות', 'נקבה'];

                            if (womenKeywords.some(kw => rawType.toLowerCase().includes(kw))) {
                                typeVal = 'W';
                            }

                            const coach = (coachIndex !== -1) ? row[coachIndex] : '';
                            const key = `${name.trim()}_${coach ? coach.trim() : ''}`; // Unique key

                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                uniqueTeams.push({
                                    name: name.trim(),
                                    coach: coach ? coach.trim() : '',
                                    type: typeVal,
                                    key: key,
                                    rowIndex: rowIndex // useful for updates
                                });
                            }
                        });

                        // Extract Unique Halls & Assign Colors
                        const locationsSet = new Set();
                        dataRows.forEach(row => {
                            for (let i = dayStartIndex; i < dayStartIndex + 7; i++) {
                                const cell = row[i];
                                if (!cell) continue;
                                const nums = cell.replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);
                                if (nums) {
                                    let loc = cell.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').trim();
                                    loc = loc.replace(/משחק|ב-|🏀|🏃/g, '').replace('אתלטיקה', '').replace('בית', '').replace('חוץ', '').trim();
                                    if (loc) locationsSet.add(loc);
                                }
                            }
                        });

                        const locationPalette = [
                            '#fecaca', '#fde68a', '#d9f99d', '#a7f3d0', '#99f6e4',
                            '#bae6fd', '#c7d2fe', '#ddd6fe', '#fbcfe8', '#fecdd3',
                            '#bbf7d0', '#e9d5ff', '#a5f3fc', '#bfdbfe', '#fef08a'
                        ];

                        const hallColorsMap = {};
                        // Process 'משחק' or 'Games' specially if needed, but here we just map found locations
                        let colorIdx = 0;
                        Array.from(locationsSet).sort().forEach(loc => {
                            if (loc === 'משחק' || loc.includes('משחק')) {
                                hallColorsMap[loc] = '#ffedd5'; // orange for games
                            } else {
                                hallColorsMap[loc] = locationPalette[colorIdx % locationPalette.length];
                                colorIdx++;
                            }
                        });


                        setSheetData({
                            headers: headerRow,
                            teams: uniqueTeams, // Now an array of objects
                            rawRows: dataRows,
                            hallColors: hallColorsMap,
                            indices: {
                                team: teamIndex,
                                coach: coachIndex,
                                type: typeIndex,
                                dayStart: dayStartIndex
                            }
                        });

                        // Initialize team config
                        // Merge Strategy: Cloud > LocalStorage > Defaults
                        setTeamConfig(prevConfig => {
                            // prevConfig here has LocalStorage data due to useEffect on mount

                            return uniqueTeams.map(teamObj => {
                                const teamKey = `${teamObj.name}_${teamObj.coach}`;

                                // 1. Cloud match?
                                if (cloudRulesMap && cloudRulesMap[teamKey]) {
                                    // Merge cloud data but use fresh type info from sheet
                                    return { ...cloudRulesMap[teamKey], type: teamObj.type };
                                }

                                // 2. Local match?
                                const existing = prevConfig.find(tc => tc.name === teamObj.name && tc.coach === teamObj.coach);
                                if (existing) {
                                    return { ...existing, type: teamObj.type };
                                }

                                // 3. Default
                                return {
                                    name: teamObj.name,
                                    coach: teamObj.coach,
                                    type: teamObj.type,
                                    sessionsPerWeek: 3,
                                    constraints: []
                                };
                            });
                        });

                        setIsConnected(true);
                    } else {
                        setError('Could not find header row starting with "קבוצות". Check the sheet structure.');
                    }
                    setLoading(false);
                },
                error: (err) => {
                    setError('Error parsing CSV: ' + err.message);
                    setLoading(false);
                }
            });
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    // Callback to update sheet data from WeekBuilder (e.g. Type Change)
    const handleTeamUpdate = (teamIndex, changes) => {
        if (!sheetData) return;

        const updatedTeams = [...sheetData.teams];
        if (!updatedTeams[teamIndex]) return;

        // Update local object
        updatedTeams[teamIndex] = { ...updatedTeams[teamIndex], ...changes };

        // Update rawRows if linked
        const rowIndex = updatedTeams[teamIndex].rowIndex;
        const newRawRows = [...sheetData.rawRows];

        if (rowIndex !== undefined && newRawRows[rowIndex]) {
            if (changes.type && sheetData.indices.type !== undefined) {
                const tIdx = sheetData.indices.type;
                if (tIdx !== -1) {
                    newRawRows[rowIndex][tIdx] = changes.type;
                }
            }
        }

        setSheetData({
            ...sheetData,
            teams: updatedTeams,
            rawRows: newRawRows
        });

        // Also update teamConfig state to keep in sync
        const newConfig = [...teamConfig];
        // assuming teamConfig order matches teams order (it should)
        if (newConfig[teamIndex]) {
            newConfig[teamIndex] = { ...newConfig[teamIndex], ...changes };
            setTeamConfig(newConfig);
        }
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'setup':
                return (
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                        <h3 style={{ marginTop: 0 }}>הגדרות חיבור לגיליון</h3>
                        <p style={{ color: '#666' }}>הדבק את כתובת ה-Google Sheet שפורסמה כ-CSV (קובץ - שתף - פרסם באינטרנט - CSV).</p>

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                            <input
                                type="text"
                                value={sheetUrl}
                                onChange={(e) => setSheetUrl(e.target.value)}
                                placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv..."
                                style={{ flex: 1, padding: '0.8rem', borderRadius: '4px', border: '1px solid #ddd' }}
                            />
                            <button
                                onClick={handleConnect}
                                disabled={loading}
                                style={{ background: '#2563eb', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                {loading ? 'טוען...' : 'תחבר וטען נתונים'}
                            </button>
                        </div>

                        {error && <div style={{ color: '#ef4444', marginTop: '1rem', background: '#fee2e2', padding: '1rem', borderRadius: '4px' }}>{error}</div>}
                    </div>
                );
            case 'weekBuilder':
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => saveRulesToCloud(teamConfig)}
                                style={{ background: '#7C3AED', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                            >
                                💾 שמור חוקים לענן (SavedRules)
                            </button>
                        </div>
                        <WeekBuilder
                            teams={sheetData?.teams || []}
                            headers={sheetData?.headers || []}
                            teamConfig={teamConfig}
                            setTeamConfig={setTeamConfig}
                            onTeamUpdate={handleTeamUpdate}
                            hallColors={sheetData?.hallColors || {}}
                        />
                    </div>
                );
            case 'preview':
                return (
                    <Preview
                        teams={sheetData?.teams || []}
                        headers={sheetData?.headers || []}
                        rawRows={sheetData?.rawRows || []}
                        teamConfig={teamConfig}
                        saveUrl={saveUrl}
                        sheetName={sheetName}
                        indices={sheetData?.indices}
                        currentSchedule={currentSchedule}
                        setCurrentSchedule={setCurrentSchedule}
                        hallColors={sheetData?.hallColors || {}}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f7fa', fontFamily: 'Rubik, sans-serif' }}>
            {/* Header */}
            <header style={{ background: 'white', padding: '1rem 2rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <img src="/men_logo.png" alt="Logo" style={{ height: '60px', width: 'auto' }} />
                        <div>
                            <h2 style={{ margin: 0, color: '#14213D' }}>מערכת ניהול - פורטל ראשי</h2>
                            <span style={{ fontSize: '0.9rem', color: '#666' }}>ניהול גברים ונשים (משותף)</span>
                        </div>
                    </div>
                </div>


                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <a href="/" target="_blank" style={{ textDecoration: 'none', color: '#3b82f6', fontSize: '0.9rem', fontWeight: 600 }}>פתח אתר 🔗</a>
                    <span style={{ fontSize: '0.9rem', color: '#666' }}>שלום, Admin</span>
                    <button
                        onClick={handleLogout}
                        style={{ background: 'none', border: '1px solid #ccc', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                    >
                        התנתק
                    </button>
                </div>
            </header >

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* Sidebar */}
                <aside style={{ width: '250px', background: 'white', borderLeft: '1px solid #eee', padding: '2rem 0' }}>
                    <nav style={{ display: 'flex', flexDirection: 'column' }}>
                        <button
                            style={menuButtonStyle(activeTab === 'setup')}
                            onClick={() => setActiveTab('setup')}
                        >
                            ⚙️ הגדרות מערכת {isConnected && '✅'}
                        </button>
                        <button
                            style={menuButtonStyle(activeTab === 'weekBuilder')}
                            onClick={() => setActiveTab('weekBuilder')}
                            disabled={!isConnected}
                            title={!isConnected ? "יש להתחבר לגיליון תחילה" : ""}
                        >
                            📅 בניית שבוע
                        </button>
                        <button
                            style={menuButtonStyle(activeTab === 'preview')}
                            onClick={() => setActiveTab('preview')}
                            disabled={!isConnected}
                        >
                            👁️ תצוגה מקדימה
                        </button>
                    </nav>
                </aside>

                {/* Content Area */}
                <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
                    {renderContent()}
                </main>
            </div>
        </div >
    );
};

const menuButtonStyle = (isActive) => ({
    background: isActive ? '#f0f9ff' : 'transparent',
    color: isActive ? '#0369a1' : '#4b5563',
    border: 'none',
    borderRight: isActive ? '4px solid #0369a1' : '4px solid transparent', // Adjusted for RTL
    padding: '1rem 1.5rem',
    textAlign: 'right', // Adjusted for RTL
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: isActive ? 600 : 400,
    display: 'flex',
    alignItems: 'center',
    gap: '0.8rem',
    marginBottom: '0.2rem'
});

export default AdminDashboard;


