import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import WeekBuilder from '../components/WeekBuilder';
import Preview from '../components/Preview';

const WomenDashboard = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('setup');

    // Setup state
    const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1fpbkPyUIGUn_wwdJDXf4dhwHvv5Y-KRYfnmv026Gs6w/edit?usp=sharing');
    const [saveUrl, setSaveUrl] = useState('https://script.google.com/macros/s/AKfycbySWYT00uCR5pboiv9QvlvArPYi8LgPAbsUHsljoOoTYADtpLkfnIcVOiXWx8y-n-1wbw/exec');   // User needs to set this up
    const [sheetName, setSheetName] = useState('Sheet1');
    const [isConnected, setIsConnected] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [sheetData, setSheetData] = useState({
        headers: [],
        teams: [],
        rawRows: []
    });
    const [teamConfig, setTeamConfig] = useState([]);

    const handleLogout = () => {
        localStorage.removeItem('isAdmin');
        navigate('/admin');
    };

    const extractSheetId = (url) => {
        const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    };

    const handleConnect = async () => {
        setLoading(true);
        setError('');
        setIsConnected(false);

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

                            const coach = (coachIndex !== -1) ? row[coachIndex] : '';
                            const key = `${name.trim()}_${coach ? coach.trim() : ''}`; // Unique key

                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                uniqueTeams.push({
                                    name: name.trim(),
                                    coach: coach ? coach.trim() : '',
                                    key: key,
                                    rowIndex: rowIndex // useful for updates
                                });
                            }
                        });


                        setSheetData({
                            headers: headerRow,
                            teams: uniqueTeams, // Now an array of objects
                            rawRows: dataRows,
                            indices: {
                                team: teamIndex,
                                coach: coachIndex,
                                dayStart: dayStartIndex
                            }
                        });

                        // Extract Unique Halls & Assign Colors
                        const locationsSet = new Set();
                        dataRows.forEach(row => {
                            for (let i = dayStartIndex; i < dayStartIndex + 7; i++) {
                                const cell = row[i];
                                if (!cell) continue;
                                // Basic extraction regex (similar to Preview.jsx logic)
                                const nums = cell.replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);
                                if (nums) {
                                    let loc = cell.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').trim();
                                    loc = loc.replace(/משחק|ב-/g, '').trim();
                                    if (loc) locationsSet.add(loc);
                                }
                            }
                        });

                        const locationPalette = [
                            '#e11d48', // rose-600
                            '#059669', // emerald-600
                            '#0284c7', // sky-600
                            '#7c3aed', // violet-600
                            '#db2777', // pink-600
                            '#d97706', // amber-600
                            '#4f46e5', // indigo-600
                            '#dc2626', // red-600
                            '#16a34a', // green-600
                            '#2563eb', // blue-600
                        ];

                        const hallColorsMap = {};
                        Array.from(locationsSet).sort().forEach((loc, idx) => {
                            hallColorsMap[loc] = locationPalette[idx % locationPalette.length];
                        });
                        // Also store this somewhere if needed, for potentially passing to other components
                        setSheetData(prev => ({ ...prev, hallColors: hallColorsMap }));

                        // Initialize team config if not exists
                        // Note: If teams change, this reset might lose configs? 
                        // For now, we regenerate based on loaded teams. 
                        // Ideally we should merge with existing config if names match.
                        setTeamConfig(prevConfig => {
                            return uniqueTeams.map(teamObj => {
                                const existing = prevConfig.find(tc => tc.name === teamObj.name && tc.coach === teamObj.coach);
                                return existing || {
                                    name: teamObj.name,
                                    coach: teamObj.coach,
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

    return (
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f7fa', fontFamily: 'Rubik, sans-serif' }}>
            {/* Header */}
            <header style={{ background: 'white', padding: '1rem 2rem', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <img src="/women_logo.png" alt="Women Logo" style={{ height: '60px', width: 'auto' }} />
                        <h2 style={{ margin: 0, color: '#BE185D' }}>מערכת ניהול - נשים</h2>
                        <span style={{ background: '#FCE7F3', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.8rem', color: '#BE185D' }}>MVP v0.1</span>
                    </div>

                    {/* Department Switcher */}
                    <div style={{ display: 'flex', background: '#fdf2f8', padding: '0.25rem', borderRadius: '8px', gap: '0.25rem' }}>
                        <button
                            onClick={() => navigate('/admin/dashboard')}
                            style={{
                                padding: '0.4rem 1.2rem',
                                borderRadius: '6px',
                                border: 'none',
                                background: 'transparent',
                                color: '#9d174d',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.target.style.background = '#fce7f3'}
                            onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >גברים</button>
                        <button style={{
                            padding: '0.4rem 1.2rem',
                            borderRadius: '6px',
                            border: 'none',
                            background: 'white',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                            color: '#BE185D',
                            fontWeight: 600,
                            cursor: 'default'
                        }}>נשים</button>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <a href="/women" target="_blank" style={{ textDecoration: 'none', color: '#BE185D', fontSize: '0.9rem', fontWeight: 600 }}>פתח אתר 🔗</a>
                    <span style={{ fontSize: '0.9rem', color: '#666' }}>שלום, Admin</span>
                    <button
                        onClick={handleLogout}
                        style={{ background: 'none', border: '1px solid #ccc', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                    >
                        התנתק
                    </button>
                </div>
            </header>

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
                    {activeTab === 'setup' && (
                        <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                            <h3 style={{ marginTop: 0 }}>חיבור לגיליון גוגל (נשים)</h3>
                            <p style={{ color: '#666' }}>הכנס את כתובת ה-URL של הגיליון (חובה הרשאות צפייה לפחות)</p>

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                                <input
                                    type="text"
                                    value={sheetUrl}
                                    onChange={(e) => setSheetUrl(e.target.value)}
                                    style={{ flex: 1, padding: '0.8rem', borderRadius: '4px', border: '1px solid #ddd', direction: 'ltr' }}
                                    placeholder="https://docs.google.com/spreadsheets/d/..."
                                />
                                <button
                                    onClick={handleConnect}
                                    disabled={loading}
                                    style={{
                                        background: isConnected ? '#10B981' : '#DB2777',
                                        color: 'white',
                                        border: 'none',
                                        padding: '0 1.5rem',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                        opacity: loading ? 0.7 : 1
                                    }}
                                >
                                    {loading ? 'מתחבר...' : (isConnected ? 'מחובר' : 'התחבר')}
                                </button>
                            </div>

                            {error && (
                                <div style={{ marginTop: '1rem', padding: '1rem', background: '#FEF2F2', color: '#DC2626', borderRadius: '4px', border: '1px solid #FECACA' }}>
                                    {error}
                                </div>
                            )}

                            {isConnected && (
                                <div style={{ marginTop: '2rem', padding: '1rem', background: '#ECFDF5', border: '1px solid #D1FAE5', borderRadius: '4px' }}>
                                    <h4 style={{ margin: '0 0 0.5rem 0', color: '#047857' }}>החיבור הצליח!</h4>
                                    <ul style={{ margin: 0, paddingLeft: '1.5rem', color: '#065F46', listStylePosition: 'inside' }}>
                                        <li>נמצאו <strong>{sheetData.teams.length}</strong> קבוצות</li>
                                        <li>שורת כותרת זוהתה: {sheetData.headers.slice(0, 3).join(', ')}...</li>
                                    </ul>
                                </div>
                            )}

                            <div style={{ marginTop: '2rem' }}>
                                <h4>הגדרות שמירה (מתקדם)</h4>
                                <p style={{ fontSize: '0.9rem', color: '#666' }}>כדי לשמור ישירות לגיליון, יש ליצור <a href="/GOOGLE_SHEETS_SETUP.md" target="_blank">Google Apps Script Webhook</a>.</p>

                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>כתובת ה-API לשמירה (Web App URL)</label>
                                <input
                                    type="text"
                                    value={saveUrl}
                                    onChange={(e) => setSaveUrl(e.target.value)}
                                    placeholder="https://script.google.com/macros/s/..."
                                    style={{ width: '100%', padding: '0.8rem', borderRadius: '4px', border: '1px solid #ddd', direction: 'ltr' }}
                                />
                                {saveUrl && saveUrl.includes('/library/') && (
                                    <div style={{ color: '#E11D48', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 500 }}>
                                        🛑 שגיאה: זו כתובת של ספריה (Library). <br />
                                        אנא חזור ל-Apps Script, לחץ על <strong>Deploy</strong> (כפתור כחול) -{'>'} <strong>New deployment</strong>, ובחר "Web App". <br />
                                        העתק את הכתובת שמסתיימת ב-<code>/exec</code>.
                                    </div>
                                )}
                                {saveUrl && !saveUrl.includes('/library/') && !saveUrl.includes('macros/s/') && !saveUrl.includes('script.google.com') && (
                                    <div style={{ color: '#F59E0B', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                        ⚠️ שים לב: הכתובת לא נראית כמו כתובת Google Apps Script תקינה.
                                    </div>
                                )}
                            </div>

                            <div style={{ marginTop: '2rem' }}>
                                <h4>הגדרות נוספות</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>שם הגיליון (Tab)</label>
                                        <input
                                            type="text"
                                            value={sheetName}
                                            onChange={(e) => setSheetName(e.target.value)}
                                            style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>מיפוי עמודות</label>
                                        <div style={{ padding: '0.5rem', background: '#f9fafb', borderRadius: '4px', fontSize: '0.9rem', color: '#666' }}>
                                            זיהוי אוטומטי (כותרת בשורה 2, קבוצות בעמודה A)
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'weekBuilder' && (
                        <WeekBuilder
                            teams={sheetData.teams}
                            headers={sheetData.headers}
                            teamConfig={teamConfig}
                            setTeamConfig={setTeamConfig}
                            indices={sheetData.indices}
                            hallColors={sheetData.hallColors}
                        />
                    )}

                    {activeTab === 'preview' && (
                        <Preview
                            teams={sheetData.teams}
                            headers={sheetData.headers}
                            rawRows={sheetData.rawRows}
                            teamConfig={teamConfig}
                            saveUrl={saveUrl}
                            sheetName={sheetName}
                            indices={sheetData.indices}
                        />
                    )}
                </main>
            </div>
        </div>
    );
};

const menuButtonStyle = (isActive) => ({
    background: isActive ? '#fdf2f8' : 'transparent',
    color: isActive ? '#be185d' : '#4b5563',
    border: 'none',
    borderRight: isActive ? '4px solid #be185d' : '4px solid transparent', // Adjusted for RTL
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

export default WomenDashboard;
