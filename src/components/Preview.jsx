import { useState } from 'react';
import Papa from 'papaparse';

const Preview = ({ teams, headers, rawRows, teamConfig, saveUrl, sheetName, indices }) => {
    const [generatedSchedule, setGeneratedSchedule] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Manage headers locally
    const [currentHeaders, setCurrentHeaders] = useState(headers || []);
    const [selectedDate, setSelectedDate] = useState('');

    // Update local headers when props change
    if (currentHeaders.length === 0 && headers && headers.length > 0) {
        setCurrentHeaders(headers);
    }

    const dayStart = indices?.dayStart || 1;
    const coachIndex = indices?.coach;

    // Calculate conflicts
    // Returns a Set of "rowIndex_colIndex" strings that have conflicts
    const conflicts = (() => {
        const conflictSet = new Set();
        const data = generatedSchedule || rawRows;
        if (!data) return conflictSet;

        const coachMap = {}; // coachName -> day -> [{start, end, row, col}]

        data.forEach((row, rIdx) => {
            // Find coach for this row (either from row data or matching config)
            // The row might be raw array.
            // If we passed indices, we can look up coach column.
            let coachName = '';
            if (coachIndex !== undefined && coachIndex !== -1) {
                coachName = row[coachIndex];
            } else {
                // Fallback: try to find in teamConfig by name (row[0])
                const cfg = teamConfig.find(tc => tc.name === row[0]);
                if (cfg) coachName = cfg.coach;
            }

            if (!coachName || !coachName.trim()) return;
            coachName = coachName.trim();

            if (!coachMap[coachName]) coachMap[coachName] = {};

            // Check each day column
            for (let d = 0; d < 7; d++) {
                const cIdx = dayStart + d;
                const cellContent = row[cIdx];
                if (!cellContent || typeof cellContent !== 'string') continue;

                // Parse time from cell (e.g. "Maccabi 17:00-18:30")
                const timeMatch = cellContent.match(/(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/); // simple regex search
                // Or searching for just one time if "1700" format?
                // Let's use a robust parser helper or just look for 4 digits ranges
                // Existing format appears to be "Location 1700-1830" or "Location 17:00-18:30"
                // Let's normalize
                const nums = cellContent.replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);

                if (nums) {
                    const start = parseInt(nums[1]);
                    const end = parseInt(nums[2]);

                    if (!coachMap[coachName][d]) coachMap[coachName][d] = [];

                    // Check overlap with existing events for this coach on this day
                    const events = coachMap[coachName][d];
                    let hasConflict = false;

                    events.forEach(ev => {
                        if (Math.max(start, ev.start) < Math.min(end, ev.end)) {
                            // Overlap found!
                            conflictSet.add(`${rIdx}_${cIdx}`);
                            conflictSet.add(`${ev.row}_${ev.col}`);
                            hasConflict = true;
                        }
                    });

                    events.push({ start, end, row: rIdx, col: cIdx });
                }
            }
        });
        return conflictSet;
    })();


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

    const dayHeaders = currentHeaders.length > 0 ? currentHeaders.slice(dayStart, dayStart + 7) : [];

    const handleDateChange = (e) => {
        const dateVal = e.target.value;
        setSelectedDate(dateVal);

        if (!dateVal) return;

        const start = new Date(dateVal);
        const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

        const newHeaders = [...currentHeaders];

        // Ensure we have enough columns (up to start + 7)
        // If array is short, we might crash, but generally headers array is long enough from CSV

        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(start);
            currentDay.setDate(start.getDate() + i);

            const dayName = days[i];
            const formattedDate = `${currentDay.getDate()}/${currentDay.getMonth() + 1}`;

            // We update the specific column index
            if (newHeaders[dayStart + i]) {
                newHeaders[dayStart + i] = `${dayName} ${formattedDate}`;
            }
        }

        setCurrentHeaders(newHeaders);
    };

    // Helper to format time for sheet (17:00 -> 1700)
    const formatTimeForSheet = (timeStr) => {
        return timeStr ? timeStr.replace(':', '') : '';
    };

    const handleGenerate = () => {
        setIsGenerating(true);
        setTimeout(() => {
            // 1. Create a map of team rows for direct access
            const newSchedule = JSON.parse(JSON.stringify(rawRows)); // Deep copy

            // Resource Tracker: Set<"day_location_startTime">
            const usedResources = new Set();

            // Helper to check and book resource
            const tryBookResource = (day, location, start) => {
                const key = `${day}_${location}_${start}`;
                if (usedResources.has(key)) return false;
                usedResources.add(key);
                return true;
            };

            // 2. Process each team based on configuration
            teamConfig.forEach(team => {
                // Find row by team name AND coach if needed, but rawRows doesn't have metadata nicely attached
                // We assume rawRows order is preserved or we search by name (col 0). 
                // Since we de-duped by name+coach in WomenDashboard, we need to be careful.
                // But rawRows is just the data. 
                // We should find the row where column 0 == team.name AND column[coachIndex] == team.coach

                const teamRow = newSchedule.find(r => {
                    const nameMatch = r[0] === team.name;
                    if (!nameMatch) return false;
                    if (coachIndex !== undefined && coachIndex !== -1) {
                        return (r[coachIndex] || '').trim() === (team.coach || '').trim();
                    }
                    return true;
                });

                if (!teamRow) return;

                let sessionsScheduled = 0;
                const sessionsNeeded = team.sessionsPerWeek;
                const constraints = team.constraints || [];
                const occupiedDays = new Set(); // Days where team already has an event

                // Phase 0: Scan existing data
                for (let d = 0; d < 7; d++) {
                    const colIndex = dayStart + d;
                    const cellContent = teamRow[colIndex];
                    if (cellContent && cellContent.trim() !== '' && cellContent !== 'xxxxxxxx') {
                        occupiedDays.add(d);
                        sessionsScheduled++;
                    }
                }

                // Phase 1: Apply Hard Constraints
                constraints.forEach(c => {
                    const colIndex = dayStart + c.day; // Use dynamic start
                    const startRaw = formatTimeForSheet(c.startTime);
                    const endRaw = formatTimeForSheet(c.endTime);

                    if (c.type === 'OFF') {
                        teamRow[colIndex] = 'xxxxxxxx';
                        occupiedDays.add(c.day);
                    } else if (c.type === 'MATCH') {
                        teamRow[colIndex] = `משחק ב${c.location} ${startRaw}`;
                        occupiedDays.add(c.day);
                        if (c.location && startRaw) {
                            tryBookResource(c.day, c.location, startRaw);
                        }
                    } else if (c.type === 'FIXED') {
                        teamRow[colIndex] = `${c.location} ${startRaw}-${endRaw}`;
                        occupiedDays.add(c.day);
                        if (c.location && startRaw) {
                            tryBookResource(c.day, c.location, startRaw);
                        }
                    }
                });

                // Recalculate sessions
                sessionsScheduled = 0;
                for (let d = 0; d < 7; d++) {
                    const colIndex = dayStart + d;
                    const cellContent = teamRow[colIndex];
                    if (cellContent && cellContent.trim() !== '' && cellContent !== 'xxxxxxxx') {
                        sessionsScheduled++;
                    }
                }

                // Phase 2: Fill Remaining Sessions
                let sessionsToFill = sessionsNeeded - sessionsScheduled;

                for (let d = 0; d < 7 && sessionsToFill > 0; d++) {
                    if (occupiedDays.has(d)) continue;

                    let foundSlotForDay = false;

                    for (const loc of LOCATIONS) {
                        if (foundSlotForDay) break;
                        for (const slot of TIME_SLOTS) {

                            if (team.maxEndTime) {
                                const slotEndNum = parseInt(slot.end);
                                const configuredMaxNum = parseInt(team.maxEndTime.replace(':', ''));
                                if (!isNaN(configuredMaxNum) && slotEndNum > configuredMaxNum) {
                                    continue;
                                }
                            }

                            if (tryBookResource(d, loc, slot.start)) {
                                const colIndex = dayStart + d;
                                teamRow[colIndex] = `${loc} ${slot.start}-${slot.end}`;
                                occupiedDays.add(d);
                                sessionsToFill--;
                                foundSlotForDay = true;
                                break;
                            }
                        }
                    }
                }
            });

            setGeneratedSchedule(newSchedule);
            setIsGenerating(false);
        }, 1000);
    };

    const handleCellChange = (rowIndex, colIndex, value) => {
        let currentData = generatedSchedule;
        if (!currentData) {
            try {
                currentData = JSON.parse(JSON.stringify(rawRows));
            } catch (e) {
                console.error("Error cloning rawRows", e);
                return;
            }
        } else {
            currentData = JSON.parse(JSON.stringify(currentData));
        }

        if (rowIndex >= 0 && rowIndex < currentData.length) {
            currentData[rowIndex][colIndex] = value;
            setGeneratedSchedule(currentData);
        }
    };

    const dataToShow = generatedSchedule || rawRows;

    const handleSave = async () => {
        if (saveUrl) {
            setIsSaving(true);
            try {
                const safeData = dataToShow.map(row =>
                    row.map(cell => (cell === null || cell === undefined) ? '' : String(cell))
                );

                const payload = {
                    rows: [currentHeaders, ...safeData],
                    sheetName: sheetName || 'Sheet1'
                };

                await fetch(saveUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'text/plain' }
                });

                alert('הבקשה נשלחה לגיליון! (נא לבדוק אם הוא התעדכן תוך מספר שניות)');

            } catch (err) {
                console.error("Save Error:", err);
                alert('שגיאה בשליחה לגיליון. מנסה להוריד קובץ גיבוי...');
                downloadCsv();
            } finally {
                setIsSaving(false);
            }
        } else {
            downloadCsv();
        }
    };

    const downloadCsv = () => {
        const csv = Papa.unparse({
            fields: currentHeaders,
            data: dataToShow
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const blobWithBOM = new Blob(["\ufeff", blob], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blobWithBOM);
        link.setAttribute('href', url);
        link.setAttribute('download', 'raanana_schedule_export.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: 0 }}>תצוגה מקדימה {generatedSchedule && '(תוצאת חישוב)'}</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={handleGenerate} disabled={isGenerating} style={{ background: '#FCA311', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, opacity: isGenerating ? 0.7 : 1 }}>
                        {isGenerating ? 'מחשב...' : 'צור לו"ז אוטומטי'}
                    </button>
                    <button onClick={handleSave} disabled={isSaving} style={{ background: saveUrl ? '#10B981' : '#14213D', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, opacity: isSaving ? 0.7 : 1 }}>
                        {isSaving ? 'שומר...' : (saveUrl ? 'שמור לגיליון (ענן)' : 'ייצא ל-CSV / שמור')}
                    </button>
                </div>
            </div>

            <div style={{ padding: '1rem', background: '#f0f9ff', borderRadius: '4px', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontWeight: '600', color: '#0369a1' }}>📅 עדכון תאריכים מהיר:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.9rem' }}>בחר יום ראשון:</label>
                    <input type="date" value={selectedDate} onChange={handleDateChange} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                </div>
                <span style={{ fontSize: '0.8rem', color: '#666' }}>(הכותרות בטבלה למטה יתעדכנו אוטומטית)</span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                    <tr style={{ background: '#f8f9fa' }}>
                        <th style={{ padding: '1rem', border: '1px solid #eee', textAlign: 'right', minWidth: '150px' }}>קבוצה</th>
                        {coachIndex !== undefined && coachIndex !== -1 && (
                            <th style={{ padding: '1rem', border: '1px solid #eee', textAlign: 'right', minWidth: '100px' }}>מאמן</th>
                        )}
                        {dayHeaders.map((header, i) => (
                            <th key={i} style={{ padding: '1rem', border: '1px solid #eee', textAlign: 'center', minWidth: '120px' }}>
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {teams.map((teamObj, i) => {
                        // teamObj is {name, coach, key, rowIndex} 
                        // If teams hasn't been updated to objects yet (compatibility), handle string
                        const teamName = teamObj.name || teamObj;

                        // Find row index. Preferably use rowIndex from object, otherwise search
                        let rowIndex = teamObj.rowIndex;
                        if (rowIndex === undefined) {
                            rowIndex = dataToShow.findIndex(r => r[0] === teamName);
                        }

                        const rowData = dataToShow[rowIndex];

                        return (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fcfcfc' }}>
                                <td style={{ padding: '0.8rem', border: '1px solid #eee', fontWeight: '500' }}>{teamName}</td>
                                {coachIndex !== undefined && coachIndex !== -1 && (
                                    <td style={{ padding: '0.8rem', border: '1px solid #eee', color: '#666' }}>
                                        {rowData ? rowData[coachIndex] : ''}
                                    </td>
                                )}
                                {dayHeaders.map((_, colMapIndex) => {
                                    const colIndex = dayStart + colMapIndex;
                                    const cellData = rowData ? rowData[colIndex] : '';

                                    const isConflict = conflicts.has(`${rowIndex}_${colIndex}`);

                                    return (
                                        <td key={colMapIndex} style={{
                                            padding: 0,
                                            border: isConflict ? '2px solid #ef4444' : '1px solid #eee',
                                            textAlign: 'center',
                                            backgroundColor: isConflict ? '#fee2e2' : 'transparent'
                                        }}>
                                            <input
                                                type="text"
                                                value={cellData || ''}
                                                onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    border: 'none',
                                                    padding: '0.8rem 0.5rem',
                                                    textAlign: 'center',
                                                    background: 'transparent',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                    fontWeight: 'normal',
                                                    outline: 'none',
                                                    color: isConflict ? '#b91c1c' : 'inherit'
                                                }}
                                                title={isConflict ? 'התנגשות מאמן או משאב!' : ''}
                                            />
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
