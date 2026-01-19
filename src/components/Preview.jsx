import { useState } from 'react';
import Papa from 'papaparse';

const Preview = ({ teams, headers, rawRows, teamConfig, saveUrl, sheetName }) => {
    const [generatedSchedule, setGeneratedSchedule] = useState(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

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
                const teamRow = newSchedule.find(r => r[0] === team.name);
                if (!teamRow) return;

                let sessionsScheduled = 0;
                const sessionsNeeded = team.sessionsPerWeek;
                const constraints = team.constraints || [];
                const occupiedDays = new Set(); // Days where team already has an event

                // Phase 0: Scan existing data strictly for "occupied days" and session count
                // We do NOT book specific resources from raw text yet as parsing is complex,
                // but we count it as a session to avoid over-scheduling.
                for (let d = 0; d < 7; d++) {
                    const colIndex = d + 1;
                    const cellContent = teamRow[colIndex];
                    if (cellContent && cellContent.trim() !== '' && cellContent !== 'xxxxxxxx') {
                        occupiedDays.add(d);
                        sessionsScheduled++;
                    }
                }

                // Phase 1: Apply Hard Constraints (Overwriting existing if needed)
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

                // Recalculate sessions scheduled based on the updated row state (Constraints + Originals)
                sessionsScheduled = 0;
                for (let d = 0; d < 7; d++) {
                    const colIndex = d + 1;
                    const cellContent = teamRow[colIndex];
                    if (cellContent && cellContent.trim() !== '' && cellContent !== 'xxxxxxxx') {
                        sessionsScheduled++;
                    }
                }

                // Phase 2: Fill Remaining Sessions (Auto-Scheduler)
                let sessionsToFill = sessionsNeeded - sessionsScheduled;

                for (let d = 0; d < 7 && sessionsToFill > 0; d++) {
                    if (occupiedDays.has(d)) continue; // Skip if team busy today

                    // Try to find a valid slot (Location + Time)
                    let foundSlotForDay = false;

                    for (const loc of LOCATIONS) {
                        if (foundSlotForDay) break;
                        for (const slot of TIME_SLOTS) {
                            if (tryBookResource(d, loc, slot.start)) {
                                // Success! Book it.
                                const colIndex = d + 1;
                                teamRow[colIndex] = `${loc} ${slot.start}-${slot.end} (אוטומטי)`;
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
        if (!generatedSchedule) return;
        const newSchedule = [...generatedSchedule];
        newSchedule[rowIndex][colIndex] = value;
        setGeneratedSchedule(newSchedule);
    };

    const dataToShow = generatedSchedule || rawRows;

    const handleSave = async () => {
        // If Save URL is provided, try to save to cloud
        if (saveUrl) {
            setIsSaving(true);
            try {
                // Prepare data: headers + dataRows
                const safeData = dataToShow.map(row =>
                    row.map(cell => (cell === null || cell === undefined) ? '' : String(cell))
                );

                const payload = {
                    rows: [headers, ...safeData],
                    sheetName: sheetName || 'Sheet1'
                };

                // Use 'no-cors' mode to bypass browser blocks on the response.
                await fetch(saveUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify(payload),
                    headers: {
                        'Content-Type': 'text/plain'
                    }
                });

                // Assume success if fetch didn't throw network error
                alert('הבקשה נשלחה לגיליון! (נא לבדוק אם הוא התעדכן תוך מספר שניות)');

            } catch (err) {
                console.error("Save Error:", err);
                alert('שגיאה בשליחה לגיליון. מנסה להוריד קובץ גיבוי...');
                downloadCsv();
            } finally {
                setIsSaving(false);
            }
        } else {
            // No URL - Download CSV
            downloadCsv();
        }
    };

    const downloadCsv = () => {
        const csv = Papa.unparse({
            fields: headers,
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
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        style={{
                            background: saveUrl ? '#10B981' : '#14213D',
                            color: 'white',
                            border: 'none',
                            padding: '0.6rem 1.2rem',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            opacity: isSaving ? 0.7 : 1
                        }}
                    >
                        {isSaving ? 'שומר...' : (saveUrl ? 'שמור לגיליון (ענן)' : 'ייצא ל-CSV / שמור')}
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
                        const rowIndex = dataToShow.findIndex(r => r[0] === teamName);
                        const rowData = dataToShow[rowIndex];

                        return (
                            <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fcfcfc' }}>
                                <td style={{ padding: '0.8rem', border: '1px solid #eee', fontWeight: '500' }}>{teamName}</td>
                                {dayHeaders.map((_, colMapIndex) => {
                                    const colIndex = colMapIndex + 1;
                                    const cellData = rowData ? rowData[colIndex] : '';
                                    const isGenerated = cellData && cellData.includes && cellData.includes('(אוטומטי)');

                                    return (
                                        <td key={colMapIndex} style={{
                                            padding: 0,
                                            border: '1px solid #eee',
                                            textAlign: 'center',
                                            backgroundColor: isGenerated ? '#ECFDF5' : 'transparent'
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
                                                    fontWeight: isGenerated ? '600' : 'normal',
                                                    color: isGenerated ? '#047857' : 'inherit',
                                                    outline: 'none'
                                                }}
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
