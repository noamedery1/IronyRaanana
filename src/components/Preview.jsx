import { useState } from 'react';
import Papa from 'papaparse';

const Preview = ({ teams, headers, rawRows, teamConfig, saveUrl, sheetName, indices }) => {
    const [generatedSchedule, setGeneratedSchedule] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [hoveredCell, setHoveredCell] = useState(null);

    // Manage headers locally
    const [currentHeaders, setCurrentHeaders] = useState(headers || []);
    const [selectedDate, setSelectedDate] = useState('');

    // Update local headers when props change
    if (currentHeaders.length === 0 && headers && headers.length > 0) {
        setCurrentHeaders(headers);
    }

    const dayStart = indices?.dayStart || 1;
    const coachIndex = indices?.coach;

    // Helper to get data to show
    const dataToShow = generatedSchedule || rawRows;

    // Calculate conflicts
    const conflicts = (() => {
        const conflictSet = new Set();
        const data = dataToShow;
        if (!data) return conflictSet;

        const coachMap = {};
        const hallMap = {};

        data.forEach((row, rIdx) => {
            let coachName = '';
            if (coachIndex !== undefined && coachIndex !== -1) {
                coachName = row[coachIndex];
            } else {
                const cfg = teamConfig.find(tc => tc.name === row[0]);
                if (cfg) coachName = cfg.coach;
            }
            if (coachName) coachName = coachName.trim();

            for (let d = 0; d < 7; d++) {
                const cIdx = dayStart + d;
                const cellContent = row[cIdx];
                if (!cellContent || typeof cellContent !== 'string') continue;

                const nums = cellContent.replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);

                if (nums) {
                    const start = parseInt(nums[1]);
                    const end = parseInt(nums[2]);

                    if (isNaN(start) || isNaN(end)) continue;

                    let location = cellContent.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').trim();
                    location = location.replace(/משחק|ב-/g, '').trim();
                    if (!location) location = "Unknown";

                    // Coach Check
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

                    // Hall Check
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

        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(start);
            currentDay.setDate(start.getDate() + i);
            const dayName = days[i];
            const formattedDate = `${currentDay.getDate()}/${currentDay.getMonth() + 1}`;
            if (newHeaders[dayStart + i]) {
                newHeaders[dayStart + i] = `${dayName} ${formattedDate}`;
            }
        }
        setCurrentHeaders(newHeaders);
    };

    const handleClear = () => {
        if (!window.confirm('האם אתה בטוח שברצונך לנקות את כל הלו"ז? פעולה זו תמחק את כל השיבוצים בטבלה הנוכחית.')) {
            return;
        }
        const cleanSchedule = JSON.parse(JSON.stringify(rawRows));
        cleanSchedule.forEach(row => {
            for (let i = dayStart; i < row.length; i++) {
                row[i] = '';
            }
        });
        setGeneratedSchedule(cleanSchedule);
    };

    const handleGenerate = () => {
        setIsGenerating(true);
        setTimeout(() => {
            // Deep copy rawRows to start fresh or use current
            // We'll use rawRows as base to ensure we don't duplicate constraints if re-running
            // tailored choice: Start from clean slate + constraints OR keep manual?
            // "Automatic" usually implies full generation. let's respect manual edits if they exist in `generatedSchedule`? 
            // Simpler: Start from `rawRows` (source) + Constraints.

            const newSchedule = JSON.parse(JSON.stringify(rawRows));

            // Allow manual pre-fills from current view if user edited? 
            // For now, let's assume "Generate" is a fresh calculation based on Rules.
            // If user wants to keep manual, they should add it as a constraint (Fixed).

            // Clear the schedule area first to ensure clean generation
            newSchedule.forEach(row => {
                for (let i = dayStart; i < row.length; i++) {
                    row[i] = '';
                }
            });

            // Resource Tracker
            const bookedResources = {};
            const toMin = (t) => {
                const s = String(t).padStart(4, '0');
                return parseInt(s.substring(0, 2)) * 60 + parseInt(s.substring(2, 4));
            };
            const toTimeStr = (min) => {
                const h = Math.floor(min / 60);
                const m = min % 60;
                return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
            };

            const tryBook = (resourceType, resourceName, day, startMin, endMin) => {
                if (!resourceName) return true;
                const key = `${resourceType}_${resourceName}`;
                if (!bookedResources[key]) bookedResources[key] = {};
                if (!bookedResources[key][day]) bookedResources[key][day] = [];

                const intervals = bookedResources[key][day];
                for (const iv of intervals) {
                    if (Math.max(startMin, iv.start) < Math.min(endMin, iv.end)) {
                        return false;
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

            // 1. APPLY CONSTRAINTS FIRST
            teamConfig.forEach(team => {
                if (!team.constraints) return;

                const teamRowIndex = newSchedule.findIndex(r => r[0] === team.name && (!team.coach || (r[coachIndex] || '').trim() === team.coach));
                if (teamRowIndex === -1) return;

                team.constraints.forEach(c => {
                    if (c.type === 'OFF') {
                        // Mark somewhere? We will just check this later
                        return;
                    }

                    // Fixed or Match
                    const dayIdx = c.day; // 0..6
                    const startMin = toMin(c.startTime.replace(':', ''));
                    const endMin = toMin(c.endTime.replace(':', ''));
                    const loc = c.location.trim();

                    // Place in schedule
                    const content = c.type === 'MATCH'
                        ? `🏀 משחק ${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`
                        : `${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`;

                    // Write
                    newSchedule[teamRowIndex][dayStart + dayIdx] = content;

                    // Book Resources
                    if (loc) confirmBook('HALL', loc, dayIdx, startMin, endMin);
                    if (team.coach) confirmBook('COACH', team.coach, dayIdx, startMin, endMin);
                });
            });

            // 2. GENERATE REMAINING
            const shuffledConfig = [...teamConfig].sort(() => 0.5 - Math.random());

            const CANDIDATE_STARTS = [];
            let curr = 16 * 60;
            const END_LIMIT = 22 * 60;
            while (curr < END_LIMIT) {
                CANDIDATE_STARTS.push(curr);
                curr += 30; // 30 min jumps
            }

            shuffledConfig.forEach(team => {
                const teamRowIndex = newSchedule.findIndex(r => r[0] === team.name && (!team.coach || (r[coachIndex] || '').trim() === team.coach));
                if (teamRowIndex === -1) return;

                const teamRow = newSchedule[teamRowIndex];
                const sessionsNeeded = team.sessionsPerWeek || 3;
                let sessionsScheduled = 0;

                // Count already scheduled (from constraints)
                for (let d = 0; d < 7; d++) {
                    if (teamRow[dayStart + d] && teamRow[dayStart + d].trim()) sessionsScheduled++;
                }

                let sessionsToFill = sessionsNeeded - sessionsScheduled;
                const duration = team.duration || 90;

                // Blocked days (OFF)
                const blockedDays = (team.constraints || []).filter(c => c.type === 'OFF').map(c => c.day);

                for (let d = 0; d < 7 && sessionsToFill > 0; d++) {
                    if (blockedDays.includes(d)) continue;
                    if (teamRow[dayStart + d] && teamRow[dayStart + d].trim()) continue; // Already booked

                    let foundSlot = false;
                    // Try locations
                    for (const loc of LOCATIONS) {
                        if (foundSlot) break;

                        for (const startMin of CANDIDATE_STARTS) {
                            const endMin = startMin + duration;

                            // Check Max End Time
                            if (team.maxEndTime) {
                                const limit = toMin(team.maxEndTime.replace(':', ''));
                                if (endMin > limit) continue;
                            }
                            if (endMin > END_LIMIT + 60) continue;

                            // Check Resources
                            if (!tryBook('HALL', loc, d, startMin, endMin)) continue;
                            if (team.coach && !tryBook('COACH', team.coach, d, startMin, endMin)) continue;

                            // Book
                            confirmBook('HALL', loc, d, startMin, endMin);
                            if (team.coach) confirmBook('COACH', team.coach, d, startMin, endMin);

                            teamRow[dayStart + d] = `${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`;
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
        let currentData = generatedSchedule || JSON.parse(JSON.stringify(rawRows));
        // Ensure state copy
        currentData = [...currentData];
        currentData[rowIndex] = [...currentData[rowIndex]];

        currentData[rowIndex][colIndex] = value;
        setGeneratedSchedule(currentData);
    };

    // Drag and Drop Logic
    const onDragStart = (e, rowIndex, colIndex, value) => {
        if (!value) {
            e.preventDefault();
            return;
        }
        setDragStart({ rowIndex, colIndex, value });
        e.dataTransfer.effectAllowed = "move";
    };

    const onDragOver = (e) => {
        e.preventDefault(); // Allow drop
    };

    const onDrop = (e, targetRowIndex, targetColIndex) => {
        e.preventDefault();
        if (!dragStart) return;

        // Clone current data
        let newData = generatedSchedule
            ? JSON.parse(JSON.stringify(generatedSchedule))
            : JSON.parse(JSON.stringify(rawRows));

        // Move value
        const valToMove = dragStart.value;
        const targetVal = newData[targetRowIndex][targetColIndex];

        // If dragging to same cell, do nothing
        if (dragStart.rowIndex === targetRowIndex && dragStart.colIndex === targetColIndex) {
            setDragStart(null);
            return;
        }

        // Overwrite target, clear source
        newData[targetRowIndex][targetColIndex] = valToMove; // Or swap? User said "move... drag and drop", assuming move.
        // Confirm: "move sunday 11:00 for team a to monday team b" implies the source becomes empty.
        newData[dragStart.rowIndex][dragStart.colIndex] = '';

        setGeneratedSchedule(newData);
        setDragStart(null);
    };

    const handleCellClear = (rIdx, cIdx) => {
        handleCellChange(rIdx, cIdx, '');
    };


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

                console.log("Saving to URL:", saveUrl);

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

                // With no-cors, we can't read the response, but it means the request was sent.
                console.log("Payload sent to script:", payload);
                alert('הבקשה נשלחה! (בגלל מגבלות גישה, לא ניתן לקבל אישור סופי, אנא בדוק את הגיליון בעוד רגע)');

            } catch (err) {
                console.error("Save Error:", err);
                alert('שגיאה בשליחה לגיליון.');
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
                        נקה הכל
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
                <span style={{ fontWeight: '600', color: '#0369a1' }}>📅 עדכון תאריכים:</span>
                <input type="date" value={selectedDate} onChange={handleDateChange} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ccc' }} />
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
                        const teamName = teamObj.name || teamObj;
                        let rowIndex = teamObj.rowIndex;
                        if (rowIndex === undefined) {
                            rowIndex = dataToShow.findIndex(r => r[0] === teamName);
                        }
                        const rowData = dataToShow[rowIndex];

                        return (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fcfcfc' }}>
                                <td style={{ padding: '0.8rem', border: '1px solid #eee', fontWeight: '500' }}>
                                    {teamName}
                                    {teamObj.type && (
                                        <span style={{ fontSize: '0.7rem', marginLeft: '5px', padding: '2px 6px', borderRadius: '10px', background: teamObj.type === 'W' ? '#BE185D' : '#3B82F6', color: 'white' }}>
                                            {teamObj.type}
                                        </span>
                                    )}
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

                                    const isHovered = hoveredCell && hoveredCell.r === rowIndex && hoveredCell.c === colIndex;

                                    return (
                                        <td
                                            key={colMapIndex}
                                            style={{
                                                padding: 0,
                                                border: isConflict ? '2px solid #ef4444' : '1px solid #eee',
                                                backgroundColor: isConflict ? '#fee2e2' : 'transparent',
                                                cursor: cellData ? 'grab' : 'default',
                                                position: 'relative'
                                            }}
                                            draggable={!!cellData}
                                            onDragStart={(e) => onDragStart(e, rowIndex, colIndex, cellData)}
                                            onDragOver={onDragOver}
                                            onDrop={(e) => onDrop(e, rowIndex, colIndex)}
                                            onMouseEnter={() => setHoveredCell({ r: rowIndex, c: colIndex })}
                                            onMouseLeave={() => setHoveredCell(null)}
                                        >
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
                                                    outline: 'none',
                                                    cursor: 'inherit',
                                                    color: isConflict ? '#b91c1c' : 'inherit'
                                                }}
                                            />
                                            {cellData && isHovered && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCellClear(rowIndex, colIndex);
                                                    }}
                                                    style={{
                                                        position: 'absolute',
                                                        top: '2px',
                                                        right: '2px',
                                                        width: '18px',
                                                        height: '18px',
                                                        background: '#EF476F',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '50%',
                                                        fontSize: '10px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        cursor: 'pointer',
                                                        zIndex: 10
                                                    }}
                                                    title="נקה משבצת"
                                                >
                                                    ✕
                                                </button>
                                            )}
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
