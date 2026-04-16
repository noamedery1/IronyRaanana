import { useState } from 'react';
import Papa from 'papaparse';

const Preview = ({ teams, headers, rawRows, teamConfig, saveUrl, sheetName, sheetId, indices, currentSchedule, setCurrentSchedule, hallColors }) => {
    // const [generatedSchedule, setGeneratedSchedule] = useState(null); // Lifted up
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [hoveredCell, setHoveredCell] = useState(null);
    const [isHallPickerOpen, setIsHallPickerOpen] = useState(false);
    const [hallPickerTarget, setHallPickerTarget] = useState(null);
    const [hallStartTime, setHallStartTime] = useState('16:00');
    const [hallEndTime, setHallEndTime] = useState('17:30');

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
    const dataToShow = currentSchedule || rawRows;

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

                const lines = cellContent.split('\n');
                lines.forEach(line => {
                    if (!line || !line.trim()) return;

                    const nums = line.replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);

                    if (nums) {
                        const start = parseInt(nums[1]);
                        const end = parseInt(nums[2]);

                        if (isNaN(start) || isNaN(end)) return;

                        let location = line.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').trim();
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

                            const isMatch = cellContent.includes('משחק');

                            const hallEvents = hallMap[location][d];
                            hallEvents.forEach(ev => {
                                if (Math.max(start, ev.start) < Math.min(end, ev.end)) {
                                    // Ignore conflict if both are games
                                    if (isMatch && ev.isMatch) return;

                                    conflictSet.add(`${rIdx}_${cIdx}`);
                                    conflictSet.add(`${ev.row}_${ev.col}`);
                                }
                            });
                            hallEvents.push({ start, end, row: rIdx, col: cIdx, isMatch });
                        }
                    }
                });
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

    const normalizeTimeToken = (timeValue) => {
        if (!timeValue) return null;
        const cleaned = String(timeValue).trim().replace(':', '');
        if (!/^\d{3,4}$/.test(cleaned)) return null;
        const padded = cleaned.padStart(4, '0');
        const h = Number(padded.slice(0, 2));
        const m = Number(padded.slice(2, 4));
        if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
        return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
    };

    const formatTimeToken = (timeToken) => {
        const normalized = normalizeTimeToken(timeToken);
        if (!normalized) return '';
        return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}`;
    };

    const toMinutes = (timeToken) => {
        const normalized = normalizeTimeToken(timeToken);
        if (!normalized) return null;
        return Number(normalized.slice(0, 2)) * 60 + Number(normalized.slice(2, 4));
    };

    const parseTimeRangeFromText = (text) => {
        if (!text) return null;
        const nums = String(text).replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);
        if (!nums) return null;
        return { start: nums[1], end: nums[2] };
    };

    const extractLocation = (line) => {
        if (!line) return '';
        let location = String(line).replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').trim();
        location = location
            .replace(/משחק|ב-|🏀|🏃/g, '')
            .replace('אתלטיקה', '')
            .replace('בית', '')
            .replace('חוץ', '')
            .trim();
        return location;
    };

    const isOverlap = (startA, endA, startB, endB) => {
        return Math.max(startA, startB) < Math.min(endA, endB);
    };

    const getAllKnownHalls = () => {
        const halls = new Set();
        LOCATIONS.forEach((loc) => halls.add(loc));
        Object.keys(hallColors || {}).forEach((loc) => halls.add(loc));

        dataToShow.forEach((row) => {
            for (let d = 0; d < 7; d++) {
                const colIdx = dayStart + d;
                const cell = row?.[colIdx];
                if (!cell || typeof cell !== 'string') continue;
                const lines = cell.split('\n');
                lines.forEach((line) => {
                    const location = extractLocation(line);
                    if (location) halls.add(location);
                });
            }
        });

        return Array.from(halls).filter(Boolean).sort((a, b) => a.localeCompare(b, 'he'));
    };

    const getHallAvailability = () => {
        if (!hallPickerTarget) return { available: [], unavailable: [] };

        const startToken = normalizeTimeToken(hallStartTime);
        const endToken = normalizeTimeToken(hallEndTime);
        const startMin = toMinutes(startToken);
        const endMin = toMinutes(endToken);

        if (!startToken || !endToken || startMin === null || endMin === null || endMin <= startMin) {
            return { available: [], unavailable: [] };
        }

        const occupied = new Map();
        const allHalls = getAllKnownHalls();

        dataToShow.forEach((row, rIdx) => {
            const cell = row?.[hallPickerTarget.colIndex];
            if (!cell || typeof cell !== 'string') return;

            const lines = cell.split('\n');
            lines.forEach((line) => {
                const nums = String(line).replace(/:/g, '').match(/(\d{4}).*?(\d{4})/);
                if (!nums) return;

                // Ignore current slot so user can reassign the same cell
                if (rIdx === hallPickerTarget.rowIndex) return;

                const lineStart = toMinutes(nums[1]);
                const lineEnd = toMinutes(nums[2]);
                if (lineStart === null || lineEnd === null) return;
                if (!isOverlap(startMin, endMin, lineStart, lineEnd)) return;

                const location = extractLocation(line);
                if (!location) return;

                if (!occupied.has(location)) {
                    occupied.set(location, {
                        teamName: row?.[0] || 'Team',
                        range: `${nums[1]}-${nums[2]}`
                    });
                }
            });
        });

        const available = [];
        const unavailable = [];

        allHalls.forEach((hall) => {
            if (occupied.has(hall)) {
                const info = occupied.get(hall);
                unavailable.push({
                    hall,
                    reason: `תפוס ע"י ${info.teamName} (${info.range})`
                });
            } else {
                available.push({ hall });
            }
        });

        return { available, unavailable };
    };

    const openHallPicker = (rowIndex, colIndex, dayLabel, teamName, currentValue) => {
        if (rowIndex === undefined || rowIndex < 0) return;
        const parsedRange = parseTimeRangeFromText(currentValue);
        setHallStartTime(parsedRange ? formatTimeToken(parsedRange.start) : '16:00');
        setHallEndTime(parsedRange ? formatTimeToken(parsedRange.end) : '17:30');
        setHallPickerTarget({
            rowIndex,
            colIndex,
            dayLabel,
            teamName
        });
        setIsHallPickerOpen(true);
    };

    const applyHallToTargetCell = (hallName) => {
        if (!hallPickerTarget) return;
        const startToken = normalizeTimeToken(hallStartTime);
        const endToken = normalizeTimeToken(hallEndTime);
        const startMin = toMinutes(startToken);
        const endMin = toMinutes(endToken);

        if (!startToken || !endToken || startMin === null || endMin === null || endMin <= startMin) {
            alert('טווח השעות לא תקין. אנא הזן שעה התחלה וסיום תקינות.');
            return;
        }

        const newValue = `${hallName} ${startToken}-${endToken}`;
        handleCellChange(hallPickerTarget.rowIndex, hallPickerTarget.colIndex, newValue);
        setIsHallPickerOpen(false);
        setHallPickerTarget(null);
    };

    const closeHallPicker = () => {
        setIsHallPickerOpen(false);
        setHallPickerTarget(null);
    };

    const hallAvailability = getHallAvailability();



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
                    let content = `${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`;
                    if (c.type === 'MATCH') {
                        const where = c.subType === 'AWAY' ? 'חוץ' : (c.subType === 'HOME' ? 'בית' : '');
                        content = `🏀 משחק ${where} ${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`.replace('  ', ' ');
                    } else if (c.type === 'ATHLETICS') {
                        content = `🏃 אתלטיקה ${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`;
                    }

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

            setCurrentSchedule(newSchedule);
            setIsGenerating(false);
        }, 1000);
    };

    const handleCellChange = (rowIndex, colIndex, value) => {
        let currentData = currentSchedule || JSON.parse(JSON.stringify(rawRows));
        // Ensure state copy
        currentData = [...currentData];
        currentData[rowIndex] = [...currentData[rowIndex]];

        currentData[rowIndex][colIndex] = value;
        setCurrentSchedule(currentData);
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
        let newData = currentSchedule
            ? JSON.parse(JSON.stringify(currentSchedule))
            : JSON.parse(JSON.stringify(rawRows));

        // Swap values
        const valToMove = dragStart.value;
        const targetVal = newData[targetRowIndex][targetColIndex];

        newData[targetRowIndex][targetColIndex] = valToMove;
        newData[dragStart.rowIndex][dragStart.colIndex] = targetVal; // SWAP

        setCurrentSchedule(newData);
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
                    sheetName: sheetName || 'Sheet1',
                    sheetId: sheetId
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

    const handleClear = () => {
        if (window.confirm('האם אתה בטוח שברצונך לנקות את כל השינויים ולחזור למצב הגיליון המקורי?')) {
            setCurrentSchedule(null);
        }
    };

    return (
        <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', overflowX: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: 0 }}>תצוגה מקדימה {currentSchedule && '(תוצאת חישוב)'}</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={handleClear} style={{ background: '#EF476F', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
                        נקה הכל (חזור למקור)
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

                                    let bgColor = 'transparent';
                                    if (isConflict) {
                                        bgColor = '#fee2e2';
                                    } else if (cellData && hallColors) {
                                        const cleanLoc = cellData.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').replace(/משחק|ב-|🏀|🏃/g, '').replace('אתלטיקה', '').replace('בית', '').replace('חוץ', '').trim();
                                        const matchedLoc = Object.keys(hallColors).find(l =>
                                            (l === 'משחק' && cellData.includes('משחק')) ||
                                            cleanLoc.includes(l)
                                        );
                                        if (matchedLoc) {
                                            bgColor = hallColors[matchedLoc];
                                        } else if (cellData.includes('משחק')) {
                                            bgColor = '#ffedd5';
                                        } else if (cleanLoc) {
                                            // Fallback dynamic pastel color
                                            const palette = [
                                                '#fecaca', '#fde68a', '#d9f99d', '#a7f3d0', '#99f6e4',
                                                '#bae6fd', '#c7d2fe', '#ddd6fe', '#fbcfe8', '#fecdd3',
                                                '#bbf7d0', '#e9d5ff', '#a5f3fc', '#bfdbfe', '#fef08a'
                                            ];
                                            let hash = 0;
                                            for (let i = 0; i < cleanLoc.length; i++) {
                                                hash = cleanLoc.charCodeAt(i) + ((hash << 5) - hash);
                                            }
                                            bgColor = palette[Math.abs(hash) % palette.length];
                                        }
                                    }

                                    return (
                                        <td
                                            key={colMapIndex}
                                            style={{
                                                padding: 0,
                                                border: isConflict ? '2px solid #ef4444' : '1px solid #eee',
                                                backgroundColor: bgColor,
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
                                            <textarea
                                                value={cellData || ''}
                                                onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    border: 'none',
                                                    padding: '0.4rem',
                                                    textAlign: 'center',
                                                    background: 'transparent',
                                                    outline: 'none',
                                                    cursor: 'inherit',
                                                    color: isConflict ? '#b91c1c' : 'inherit',
                                                    resize: 'none',
                                                    fontFamily: 'inherit',
                                                    fontSize: 'inherit',
                                                    lineHeight: '1.4',
                                                    whiteSpace: 'pre-wrap',
                                                    overflow: 'hidden' // Or 'auto' if scrolling needed, but let's encourage concise content or expand row height? row heights are dynamic in table.
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
                                            {isHovered && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        openHallPicker(rowIndex, colIndex, dayHeaders[colMapIndex], teamName, cellData || '');
                                                    }}
                                                    style={{
                                                        position: 'absolute',
                                                        bottom: '2px',
                                                        left: '2px',
                                                        background: '#2563eb',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        fontSize: '10px',
                                                        padding: '2px 6px',
                                                        cursor: 'pointer',
                                                        zIndex: 10
                                                    }}
                                                    title="מצא אולם פנוי לפי שעה"
                                                >
                                                    + אולם
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

            {isHallPickerOpen && hallPickerTarget && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    right: 0,
                    left: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2000
                }}>
                    <div style={{
                        width: 'min(760px, 94vw)',
                        maxHeight: '85vh',
                        overflowY: 'auto',
                        background: 'white',
                        borderRadius: '10px',
                        padding: '1rem 1.25rem',
                        boxShadow: '0 12px 30px rgba(0,0,0,0.2)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0 }}>בחירת אולם פנוי</h4>
                            <button
                                onClick={closeHallPicker}
                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1rem' }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ marginTop: '0.6rem', color: '#374151', fontSize: '0.9rem' }}>
                            <strong>קבוצה:</strong> {hallPickerTarget.teamName} | <strong>יום:</strong> {hallPickerTarget.dayLabel}
                        </div>

                        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.9rem' }}>משעה:</label>
                            <input
                                type="time"
                                value={hallStartTime}
                                onChange={(e) => setHallStartTime(e.target.value)}
                                style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ddd' }}
                            />
                            <label style={{ fontSize: '0.9rem' }}>עד שעה:</label>
                            <input
                                type="time"
                                value={hallEndTime}
                                onChange={(e) => setHallEndTime(e.target.value)}
                                style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid #ddd' }}
                            />
                        </div>

                        <div style={{ marginTop: '1rem' }}>
                            <h5 style={{ margin: '0 0 0.5rem 0', color: '#065f46' }}>
                                אולמות פנויים ({hallAvailability.available.length})
                            </h5>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {hallAvailability.available.map((item) => (
                                    <button
                                        key={item.hall}
                                        onClick={() => applyHallToTargetCell(item.hall)}
                                        style={{
                                            border: '1px solid #10b981',
                                            background: '#ecfdf5',
                                            color: '#065f46',
                                            borderRadius: '999px',
                                            padding: '0.35rem 0.75rem',
                                            cursor: 'pointer',
                                            fontWeight: 600
                                        }}
                                    >
                                        {item.hall}
                                    </button>
                                ))}
                                {hallAvailability.available.length === 0 && (
                                    <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                                        אין אולמות פנויים בטווח השעות שנבחר.
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ marginTop: '1rem' }}>
                            <h5 style={{ margin: '0 0 0.5rem 0', color: '#92400e' }}>
                                אולמות תפוסים ({hallAvailability.unavailable.length})
                            </h5>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {hallAvailability.unavailable.map((item) => (
                                    <div
                                        key={item.hall}
                                        style={{
                                            background: '#fffbeb',
                                            border: '1px solid #fcd34d',
                                            borderRadius: '6px',
                                            padding: '0.45rem 0.6rem',
                                            fontSize: '0.9rem'
                                        }}
                                    >
                                        <strong>{item.hall}</strong> - {item.reason}
                                    </div>
                                ))}
                                {hallAvailability.unavailable.length === 0 && (
                                    <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                                        אין התנגשויות ידועות בטווח.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Preview;
