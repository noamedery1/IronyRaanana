import { useState } from 'react';

const Preview = ({ teams, headers, rawRows, teamConfig }) => {
    const [generatedSchedule, setGeneratedSchedule] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // Available resources
    const LOCATIONS = ['מטרו', 'השרון', 'רימון', 'אביב', 'תיכון חדש'];
    const TIME_SLOTS = [
        { start: '1600', end: '1730' },
        { start: '1730', end: '1900' },
        { start: '1900', end: '2030' },
        { start: '2030', end: '2200' }
    ];

    if (!teams || teams.length === 0) {
        return (
            <div style={{ textAlign: 'center', color: '#666', marginTop: '2rem' }}>
                <p>אין נתונים לתצוגה. אנא התחבר לגיליון בלשונית ההגדרות.</p>
            </div>
        );
    }

    const dayHeaders = headers ? headers.slice(1, 8) : [];

    // Helper to format time for sheet (17:00 -> 1700)
    const formatTimeForSheet = (timeStr) => {
        return timeStr ? timeStr.replace(':', '') : '';
    };

    const handleGenerate = () => {
        setIsGenerating(true);
        setTimeout(() => {
            // 1. Create a map of team rows for direct access
            const newSchedule = JSON.parse(JSON.stringify(rawRows)); // Deep copy

            // 2. Clear existing weekly data in the grid (cols 1-7) for all teams
            newSchedule.forEach(row => {
                for (let i = 1; i <= 7; i++) {
                    row[i] = ""; // Reset to empty
                }
            });

            // Resource Tracker: Set<"day_location_startTime">
            const usedResources = new Set();

            // Helper to check and book resource
            const tryBookResource = (day, location, start) => {
                const key = `${day}_${location}_${start}`;
                if (usedResources.has(key)) return false;
                usedResources.add(key);
                return true;
            };

            // 3. Process each team based on configuration
            teamConfig.forEach(team => {
                const teamRow = newSchedule.find(r => r[0] === team.name);
                if (!teamRow) return;

                let sessionsScheduled = 0;
                const sessionsNeeded = team.sessionsPerWeek;
                const constraints = team.constraints || [];
                const occupiedDays = new Set(); // Days where team already has an event

                // phase 1: Apply Hard Constraints
                constraints.forEach(c => {
                    const colIndex = c.day + 1;
                    const startRaw = formatTimeForSheet(c.startTime);
                    const endRaw = formatTimeForSheet(c.endTime);

                    if (c.type === 'OFF') {
                        teamRow[colIndex] = 'xxxxxxxx';
                        occupiedDays.add(c.day);
                    } else if (c.type === 'MATCH') {
                        teamRow[colIndex] = `משחק ב${c.location} ${startRaw}`;
                        occupiedDays.add(c.day);
                        // Book resource for match if location/time is known (assuming matches block the court)
                        if (c.location && startRaw) {
                            tryBookResource(c.day, c.location, startRaw);
                        }
                        sessionsScheduled++;
                    } else if (c.type === 'FIXED') {
                        teamRow[colIndex] = `${c.location} ${startRaw}-${endRaw}`;
                        occupiedDays.add(c.day);
                        if (c.location && startRaw) {
                            tryBookResource(c.day, c.location, startRaw);
                        }
                        sessionsScheduled++;
                    }
                });

                // Phase 2: Fill Remaining Sessions (Auto-Scheduler)
                let sessionsToFill = sessionsNeeded - sessionsScheduled;

                // Try to find slots on empty days
                // Iterate through days 0 (Sun) to 6 (Sat)
                for (let d = 0; d < 7 && sessionsToFill > 0; d++) {
                    if (occupiedDays.has(d)) continue; // Skip if team busy today

                    // Try to find a valid slot (Location + Time)
                    let foundSlotForDay = false;

                    // Simple logic: Try random location/time to distribute load, or iterate linearly?
                    // Linear iteration ensures we fill up resources systematically.
                    for (const loc of LOCATIONS) {
                        if (foundSlotForDay) break; // Found a slot for this day, move to next day
                        for (const slot of TIME_SLOTS) {
                            if (tryBookResource(d, loc, slot.start)) {
                                // Success! Book it.
                                const colIndex = d + 1;
                                teamRow[colIndex] = `${loc} ${slot.start}-${slot.end} (אוטומטי)`;
                                occupiedDays.add(d);
                                sessionsToFill--;
                                foundSlotForDay = true;
                                break; // Move to next location
                            }
                        }
                    }
                }
            });

            setGeneratedSchedule(newSchedule);
            setIsGenerating(false);
        }, 1000);
    };

    const dataToShow = generatedSchedule || rawRows;

    return (
        <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: 0 }}>תצוגה מקדימה {generatedSchedule && '(תוצאת חישוב)'}</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        style={{
                            background: '#FCA311',
                            color: 'white',
                            border: 'none',
                            padding: '0.6rem 1.2rem',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            opacity: isGenerating ? 0.7 : 1
                        }}
                    >
                        {isGenerating ? 'מחשב...' : 'צור לו"ז אוטומטי'}
                    </button>
                    <button style={{ background: '#14213D', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
                        שמור לגיליון
                    </button>
                </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                    <tr style={{ background: '#f8f9fa' }}>
                        <th style={{ padding: '1rem', border: '1px solid #eee', textAlign: 'right', minWidth: '150px' }}>קבוצה</th>
                        {dayHeaders.map((header, i) => (
                            <th key={i} style={{ padding: '1rem', border: '1px solid #eee', textAlign: 'center', minWidth: '120px' }}>
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {teams.map((teamName, i) => {
                        const rowData = dataToShow.find(r => r[0] === teamName);

                        return (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fcfcfc' }}>
                                <td style={{ padding: '0.8rem', border: '1px solid #eee', fontWeight: '500' }}>{teamName}</td>
                                {dayHeaders.map((_, colIndex) => {
                                    const cellData = rowData ? rowData[colIndex + 1] : '';
                                    const isGenerated = cellData === "אימון שובץ (דמו)";

                                    return (
                                        <td key={colIndex} style={{
                                            padding: '0.5rem',
                                            border: '1px solid #eee',
                                            textAlign: 'center',
                                            color: isGenerated ? '#047857' : 'inherit',
                                            fontWeight: isGenerated ? 'bold' : 'normal',
                                            backgroundColor: isGenerated ? '#ECFDF5' : 'transparent'
                                        }}>
                                            {cellData}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default Preview;
