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
        const hallMap = {}; // hallName -> day -> [{start, end, row, col}]

        data.forEach((row, rIdx) => {
            // Coach
            let coachName = '';
            if (coachIndex !== undefined && coachIndex !== -1) {
                coachName = row[coachIndex];
            } else {
                const cfg = teamConfig.find(tc => tc.name === row[0]);
                if (cfg) coachName = cfg.coach;
            }
            if (coachName) coachName = coachName.trim();

            // Check each day
            for (let d = 0; d < 7; d++) {
                const cIdx = dayStart + d;
                const cellContent = row[cIdx];
                if (!cellContent || typeof cellContent !== 'string') continue;

                // Normalize time parsing - "Location 1700-1830"
                const nums = cellContent.replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);

                if (nums) {
                    const start = parseInt(nums[1]);
                    const end = parseInt(nums[2]);

                    if (isNaN(start) || isNaN(end)) continue;

                    // Extract Location (remove time digits)
                    let location = cellContent.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').trim();
                    location = location.replace(/משחק|ב-/g, '').trim();
                    if (!location) location = "Unknown";

                    // 1. Check Coach Conflict
                    if (coachName) {
                        if (!coachMap[coachName]) coachMap[coachName] = {};
                        if (!coachMap[coachName][d]) coachMap[coachName][d] = [];

                        const coachEvents = coachMap[coachName][d];
                        coachEvents.forEach(ev => {
                            if (Math.max(start, ev.start) < Math.min(end, ev.end)) {
                                conflictSet.add(`${rIdx}_${cIdx}`);
                                conflictSet.add(`${ev.row}_${ev.col}`);
                            }
                        });
                        coachEvents.push({ start, end, row: rIdx, col: cIdx });
                    }

                    // 2. Check Hall Conflict
                    if (location) {
                        if (!hallMap[location]) hallMap[location] = {};
                        if (!hallMap[location][d]) hallMap[location][d] = [];

                        const hallEvents = hallMap[location][d];
                        hallEvents.forEach(ev => {
                            if (Math.max(start, ev.start) < Math.min(end, ev.end)) {
                                conflictSet.add(`${rIdx}_${cIdx}`);
                                conflictSet.add(`${ev.row}_${ev.col}`);
                            }
                        });
                        hallEvents.push({ start, end, row: rIdx, col: cIdx });
                    }
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

    const handleClear = () => {
        if (!window.confirm('האם אתה בטוח שברצונך לנקות את כל הלו"ז? פעולה זו תמחק את כל השיבוצים בטבלה הנוכחית (לא בגיליון המקורי עד שתשמור).')) {
            return;
        }

        // Clone rawRows
        const cleanSchedule = JSON.parse(JSON.stringify(rawRows));

        // Iterate and clear day columns
        cleanSchedule.forEach(row => {
            // We assume row has length > dayStart
            for (let i = dayStart; i < row.length; i++) {
                row[i] = ''; // Clear cell
            }
        });

        setGeneratedSchedule(cleanSchedule);
    };

    const handleGenerate = () => {
        setIsGenerating(true);
        setTimeout(() => {
            // 1. Create a map of team rows for direct access
            const newSchedule = JSON.parse(JSON.stringify(rawRows)); // Deep copy

            // Resource Tracker: Map<Location|Coach, Map<Day, Array<{start, end}>>>
            const bookedResources = {};

            // Helper to parse time string "HHMM" to minutes
            const toMin = (t) => {
                const s = String(t).padStart(4, '0');
                const h = parseInt(s.substring(0, 2));
                const m = parseInt(s.substring(2, 4));
                return h * 60 + m;
            };

            // Helper to check and book
            const tryBook = (resourceType, resourceName, day, startMin, endMin) => {
                if (!resourceName) return true; // No resource to check (e.g. no coach)
                const key = `${resourceType}_${resourceName}`;
                if (!bookedResources[key]) bookedResources[key] = {};
                if (!bookedResources[key][day]) bookedResources[key][day] = [];

                // Check overlap
                const intervals = bookedResources[key][day];
                for (const iv of intervals) {
                    if (Math.max(startMin, iv.start) < Math.min(endMin, iv.end)) {
                        return false; // Overlap
                    }
                }
                return true;
            };

            const confirmBook = (resourceType, resourceName, day, startMin, endMin) => {
                if (!resourceName) return;
                const key = `${resourceType}_${resourceName}`;
                if (!bookedResources[key]) bookedResources[key] = {};
                if (!bookedResources[key][day]) bookedResources[key][day] = [];
                bookedResources[key][day].push({ start: startMin, end: endMin });
            };

            // Pre-fill existing manual bookings or constraints from the sheet if needed?
            // For now we assume we overwrite or fill empty.
            // Better to SCAN existing cells first to populate `bookedResources`.

            // Scan existing schedule to block resources
            teamConfig.forEach(team => {
                const teamRow = newSchedule.find(r => r[0] === team.name && (!team.coach || (r[coachIndex] || '').trim() === team.coach));
                if (!teamRow) return;

                for (let d = 0; d < 7; d++) {
                    const colIndex = dayStart + d;
                    const cell = teamRow[colIndex];
                    if (cell && cell.trim()) {
                        // Parse rough time
                        const nums = cell.replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);
                        if (nums) {
                            const s = toMin(nums[1]);
                            const e = toMin(nums[2]);
                            // Extract location roughly
                            let loc = cell.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').trim();
                            loc = loc.replace(/משחק|ב-/g, '').trim();

                            if (loc) confirmBook('HALL', loc, d, s, e);
                            if (team.coach) confirmBook('COACH', team.coach, d, s, e);
                        } else if (cell.includes('xxxxxxxx')) {
                            // Block full day? Or just mark occupied?
                            // OFF day doesn't block resources necessarily, but stops us from booking this team
                        }
                    }
                }
            });


            // Generate Candidates
            // Possible start times every 30 or 45 mins from 16:00 to 22:00
            const CANDIDATE_STARTS = [];
            let curr = 16 * 60; // 16:00
            const END_LIMIT = 22 * 60; // 22:00
            while (curr < END_LIMIT) {
                CANDIDATE_STARTS.push(curr);
                curr += 15; // 15 min granularity for finding slots? 30 is safer for speed
            }

            // 2. Process each team
            // Sort teams by priority? maybe difficult teams first (more sessions, constraints)
            // For now simple order.

            // Shuffle teams to avoid bias?
            const shuffledConfig = [...teamConfig].sort(() => 0.5 - Math.random());

            shuffledConfig.forEach(team => {
                const teamRow = newSchedule.find(r => r[0] === team.name && (!team.coach || (r[coachIndex] || '').trim() === team.coach));
                if (!teamRow) return;

                let sessionsScheduled = 0;
                const sessionsNeeded = team.sessionsPerWeek || 3;
                const duration = team.duration || 90; // Default 90 min

                // Count existing
                for (let d = 0; d < 7; d++) {
                    if (teamRow[dayStart + d] && teamRow[dayStart + d].trim()) sessionsScheduled++;
                }

                let sessionsToFill = sessionsNeeded - sessionsScheduled;
                const preferredLocations = LOCATIONS; // Could specific this per team later

                for (let d = 0; d < 7 && sessionsToFill > 0; d++) {
                    // Check if team is free this day (simple check: if cell is empty)
                    if (teamRow[dayStart + d] && teamRow[dayStart + d].trim()) continue;

                    let foundSlot = false;

                    // Try locations
                    for (const loc of preferredLocations) {
                        if (foundSlot) break;

                        // Try start times
                        for (const startMin of CANDIDATE_STARTS) {
                            const endMin = startMin + duration;

                            // Check Max End Time
                            if (team.maxEndTime) {
                                const limit = toMin(team.maxEndTime.replace(':', ''));
                                if (endMin > limit) continue;
                            }
                            if (endMin > END_LIMIT + 60) continue; // Abs limit

                            // Check Resources: Hall & Coach
                            if (!tryBook('HALL', loc, d, startMin, endMin)) continue;
                            if (team.coach && !tryBook('COACH', team.coach, d, startMin, endMin)) continue;

                            // Success - Book it
                            confirmBook('HALL', loc, d, startMin, endMin);
                            if (team.coach) confirmBook('COACH', team.coach, d, startMin, endMin);

                            // Format text
                            const formatM = (min) => {
                                const h = Math.floor(min / 60);
                                const m = min % 60;
                                return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
                            };

                            teamRow[dayStart + d] = `${loc} ${formatM(startMin)}-${formatM(endMin)}`;
                            sessionsToFill--;
                            foundSlot = true;
                            break;
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
                    <button onClick={handleClear} style={{ background: '#EF476F', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
                        נקה הכל (שבוע חדש)
                    </button>
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
                                <td style={{ padding: '0.8rem', border: '1px solid #eee', fontWeight: '500' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {teamName}
                                        {teamObj.type && (
                                            <span style={{
                                                fontSize: '0.7rem',
                                                padding: '2px 6px',
                                                borderRadius: '10px',
                                                background: teamObj.type === 'W' ? '#BE185D' : '#3B82F6',
                                                color: 'white',
                                                fontWeight: 'bold'
                                            }}>
                                                {teamObj.type}
                                            </span>
                                        )}
                                    </div>
                                </td>
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
