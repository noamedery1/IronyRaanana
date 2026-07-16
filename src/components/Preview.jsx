import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { authHeaders } from '../adminApi.js';
import { venue, venues } from '../sportLabels.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const Preview = ({ teams, headers, rawRows, teamConfig, saveUrl, sheetName, sheetId, indices, currentSchedule, setCurrentSchedule, hallColors, hallConfig = {}, onChange, onSaveDraft, onDiscardDraft, draftSavedAt, draftRestored, clubSlug }) => {
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [isHallPickerOpen, setIsHallPickerOpen] = useState(false);
    const [hallPickerTarget, setHallPickerTarget] = useState(null);
    const [hallStartTime, setHallStartTime] = useState('16:00');
    const [hallEndTime, setHallEndTime] = useState('17:30');

    // Manage headers locally
    const [currentHeaders, setCurrentHeaders] = useState(headers || []);
    const [selectedDate, setSelectedDate] = useState('');

    // Inspector (side panel) state
    const [selectedCell, setSelectedCell] = useState(null); // { rowIndex, colIndex, teamName, dayLabel }
    const [inspStart, setInspStart] = useState('17:00');
    const [inspEnd, setInspEnd] = useState('18:30');
    const [inspHall, setInspHall] = useState('');
    const [inspType, setInspType] = useState('TRAIN'); // TRAIN | MATCH | ATHLETICS | CUSTOM
    const [inspCustom, setInspCustom] = useState(''); // free-text activity label (e.g. "אימון חוויה")
    const [activeLineIndex, setActiveLineIndex] = useState(-1); // which session in the day is being edited (-1 = new)

    const [suggestion, setSuggestion] = useState(null); // { text, row, col, newContent }
    const [draftMsg, setDraftMsg] = useState('');       // "save draft" feedback
    const [pending, setPending] = useState([]);          // trainer requests (we use 'propose' here)

    // Full-screen working mode + its helpers
    const [fullScreen, setFullScreen] = useState(false);
    const [showConflictsFS, setShowConflictsFS] = useState(false); // in FS: only show ⚠️ markers when on
    const [editModalOpen, setEditModalOpen] = useState(false);     // FS: edit a cell in a modal
    const [ctxMenu, setCtxMenu] = useState(null);                  // { x, y, rowIndex, colIndex, isConflict }

    // Resizable / collapsible inspector (splitter)
    const [inspWidth, setInspWidth] = useState(340);
    const [inspOpen, setInspOpen] = useState(true);
    const startResize = (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = inspWidth;
        const onMove = (ev) => {
            // Splitter is at the inspector's right edge: drag right → wider, drag left → narrower.
            const w = Math.max(210, Math.min(720, startW + (ev.clientX - startX)));
            setInspWidth(w);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.userSelect = '';
        };
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    // Update local headers when props change
    if (currentHeaders.length === 0 && headers && headers.length > 0) {
        setCurrentHeaders(headers);
    }

    const dayStart = indices?.dayStart || 1;
    const coachIndex = indices?.coach;

    // Helper to get data to show
    const dataToShow = currentSchedule || rawRows;

    // ---- Calculate conflicts (set for cell highlight + detailed list for the alerts banner) ----
    const computeConflicts = () => {
        const conflictSet = new Set();
        const detailsMap = new Map();
        const data = dataToShow;
        if (!data) return { set: conflictSet, details: [] };

        const addDetail = (row, col, dayIdx, reason, resource) => {
            const k = `${row}_${col}_${reason}`;
            if (detailsMap.has(k)) return;
            detailsMap.set(k, {
                key: `${row}_${col}`,
                rowIndex: row,
                colIndex: col,
                dayIndex: dayIdx,
                team: (data[row] && data[row][0]) || '',
                reason,        // 'אולם' | 'מאמן'
                resource       // hall name or coach name
            });
        };

        const coachMap = {};
        const hallMap = {};

        // capacity per hall (FULL=1, HALF=2, MULTI=courts); loose name match
        const hallCapacity = (loc) => {
            const keys = Object.keys(hallConfig || {});
            for (const k of keys) {
                if (!k) continue;
                if (loc.includes(k) || k.includes(loc)) {
                    const cfg = hallConfig[k];
                    if (cfg.type === 'HALF') return 2;
                    if (cfg.type === 'MULTI') return Math.max(2, cfg.courts || 2);
                    return 1;
                }
            }
            return 1;
        };

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

                        // Coach Check — same coach can't be in two places at once
                        if (coachName) {
                            if (!coachMap[coachName]) coachMap[coachName] = {};
                            if (!coachMap[coachName][d]) coachMap[coachName][d] = [];

                            const coachEvents = coachMap[coachName][d];
                            coachEvents.forEach(ev => {
                                if (Math.max(start, ev.start) < Math.min(end, ev.end)) {
                                    conflictSet.add(`${rIdx}_${cIdx}`);
                                    conflictSet.add(`${ev.row}_${ev.col}`);
                                    addDetail(rIdx, cIdx, d, 'מאמן', coachName);
                                    addDetail(ev.row, ev.col, d, 'מאמן', coachName);
                                }
                            });
                            coachEvents.push({ start, end, row: rIdx, col: cIdx });
                        }

                        // Hall — collect now; capacity-aware sweep happens after the loop
                        if (location) {
                            if (!hallMap[location]) hallMap[location] = {};
                            if (!hallMap[location][d]) hallMap[location][d] = [];
                            const isMatch = cellContent.includes('משחק');
                            hallMap[location][d].push({ start, end, row: rIdx, col: cIdx, isMatch });
                        }
                    }
                });
            }
        });

        // Hall conflicts: flag only when concurrent bookings exceed the hall's capacity.
        Object.keys(hallMap).forEach(loc => {
            const cap = hallCapacity(loc);
            Object.keys(hallMap[loc]).forEach(dayKey => {
                const evs = hallMap[loc][dayKey];
                const pts = [];
                evs.forEach((e, i) => {
                    pts.push({ t: e.start, o: -1, i }); // start
                    pts.push({ t: e.end, o: 1, i });     // end (process ends before starts at same time)
                });
                // at equal time, process ends (o:1) before starts (o:-1) so touching slots don't conflict
                pts.sort((a, b) => a.t - b.t || b.o - a.o);
                const active = new Set();
                pts.forEach(p => {
                    if (p.o === -1) {
                        active.add(p.i);
                        if (active.size > cap) {
                            const arr = [...active];
                            const allMatches = arr.every(idx => evs[idx].isMatch);
                            if (!allMatches) {
                                arr.forEach(idx => {
                                    const e = evs[idx];
                                    conflictSet.add(`${e.row}_${e.col}`);
                                    addDetail(e.row, e.col, Number(dayKey), 'אולם', loc);
                                });
                            }
                        }
                    } else {
                        active.delete(p.i);
                    }
                });
            });
        });

        return { set: conflictSet, details: [...detailsMap.values()] };
    };

    const { set: conflictSet, details: conflictDetails } = computeConflicts();

    // Weekly-schedule proposals (type 'propose', from the trainer's "הזנת לו\"ז") are placed
    // straight INTO the board cells in a special colour — NOT as approval requests.
    // (Change/cancel/move requests during the week stay in the separate Approvals screen.)
    const reqDayIndex = (day) => { const f = (day || '').toString().trim().split(/\s+/)[0]; return DAY_NAMES.findIndex((d) => d === f); };
    const parseProposalSlots = (reason) => {
        const body = (reason || '').includes(':') ? reason.split(':').slice(1).join(':') : (reason || '');
        return body.split('·').map((s) => s.trim()).filter(Boolean).map((part) => {
            const toks = part.split(/\s+/).filter(Boolean);
            const dayName = toks[0];
            const time = toks.find((t) => /^\d{1,2}:?\d{2}\s*[-–]\s*\d{1,2}:?\d{2}$/.test(t) || /^\d{3,4}-\d{3,4}$/.test(t)) || toks.find((t) => /\d{3,4}/.test(t)) || '';
            const loc = toks.slice(1).filter((t) => t !== time && !/^\d{1,2}\/\d{1,2}$/.test(t)).join(' ');
            return { dayName, time, loc };
        });
    };
    const proposalByCell = {};
    pending.filter((rq) => rq.type === 'propose').forEach((rq) => {
        const team = (rq.proposed && rq.proposed.team) || rq.session_team;
        const row = (dataToShow || []).findIndex((r) => r[0] === team);
        if (row < 0) return;
        parseProposalSlots(rq.reason).forEach((slot) => {
            const di = reqDayIndex(slot.dayName);
            if (di < 0) return;
            proposalByCell[`${row}_${dayStart + di}`] = { trainer: rq.requested_by, time: slot.time, loc: slot.loc };
        });
    });

    const LOCATIONS = ['מטרו', 'השרון', 'רימון', 'אביב', 'תיכון חדש'];
    const TIME_SLOTS = [
        { start: '1600', end: '1730' },
        { start: '1730', end: '1900' },
        { start: '1900', end: '2030' },
        { start: '2030', end: '2200' }
    ];

    const dayHeaders = currentHeaders.length > 0 ? currentHeaders.slice(dayStart, dayStart + 7) : [];

    // Rewrite the 7 day-headers to the week that starts on `dateVal` (yyyy-mm-dd).
    const applyWeekStart = (dateVal) => {
        if (!dateVal) return;
        const start = new Date(dateVal);
        const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        setCurrentHeaders((prev) => {
            const newHeaders = [...prev];
            for (let i = 0; i < 7; i++) {
                const currentDay = new Date(start);
                currentDay.setDate(start.getDate() + i);
                const formattedDate = `${currentDay.getDate()}/${currentDay.getMonth() + 1}`;
                if (newHeaders[dayStart + i] !== undefined) {
                    newHeaders[dayStart + i] = `${days[i]} ${formattedDate}`;
                }
            }
            return newHeaders;
        });
    };

    const handleDateChange = (e) => {
        const dateVal = e.target.value;
        setSelectedDate(dateVal);
        applyWeekStart(dateVal);
    };

    // Default the preview to the UPCOMING week (next Sunday) once headers are loaded,
    // so the dates never come up blank — it's always "work on the coming week".
    useEffect(() => {
        if (selectedDate || !currentHeaders || currentHeaders.length === 0) return;
        const d = new Date();
        const diff = (7 - d.getDay()) % 7; // 0=Sun … 6=Sat → days until the coming Sunday
        d.setDate(d.getDate() + diff);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        setSelectedDate(iso);
        applyWeekStart(iso);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentHeaders.length]);

    // Report edited rows + headers up so the parent can auto-save a draft (survives refresh).
    useEffect(() => {
        if (!onChange) return;
        const rows = currentSchedule || rawRows;
        if (!rows || !currentHeaders.length) return;
        onChange({ headers: currentHeaders, rows });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentSchedule, currentHeaders]);

    // Pending trainer requests/proposals → shown on the board (special colour) + approve/reject.
    const refreshPending = () => {
        if (!clubSlug) return;
        fetch(`/api/${clubSlug}/requests?status=pending`, { headers: authHeaders(clubSlug) })
            .then((r) => r.json()).then((d) => setPending(d.requests || [])).catch(() => {});
    };
    useEffect(() => {
        refreshPending();
        const t = setInterval(refreshPending, 30000); // auto-refresh so new proposals appear
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clubSlug]);

    const handleSaveDraft = async () => {
        setDraftMsg('שומר…');
        const r = onSaveDraft ? await onSaveDraft() : { ok: false };
        setDraftMsg(r && r.ok ? '✓ הטיוטה נשמרה' : '❌ שמירה נכשלה');
        setTimeout(() => setDraftMsg(''), 4000);
    };
    const draftTime = draftSavedAt ? new Date(draftSavedAt).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

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
                unavailable.push({ hall, reason: `תפוס ע"י ${info.teamName} (${info.range})` });
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
        setHallPickerTarget({ rowIndex, colIndex, dayLabel, teamName });
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
        // keep the inspector in sync if it targets the same cell
        if (selectedCell && selectedCell.rowIndex === hallPickerTarget.rowIndex && selectedCell.colIndex === hallPickerTarget.colIndex) {
            setInspHall(hallName);
            setInspStart(formatTimeToken(startToken));
            setInspEnd(formatTimeToken(endToken));
        }
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
            const newSchedule = JSON.parse(JSON.stringify(rawRows));

            newSchedule.forEach(row => {
                for (let i = dayStart; i < row.length; i++) {
                    row[i] = '';
                }
            });

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
                    if (Math.max(startMin, iv.start) < Math.min(endMin, iv.end)) return false;
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
                    if (c.type === 'OFF') return;

                    const dayIdx = c.day;
                    const startMin = toMin(c.startTime.replace(':', ''));
                    const endMin = toMin(c.endTime.replace(':', ''));
                    const loc = c.location.trim();

                    let content = `${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`;
                    if (c.type === 'MATCH') {
                        const where = c.subType === 'AWAY' ? 'חוץ' : (c.subType === 'HOME' ? 'בית' : '');
                        content = `🏀 משחק ${where} ${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`.replace('  ', ' ');
                    } else if (c.type === 'ATHLETICS') {
                        content = `🏃 אתלטיקה ${loc} ${toTimeStr(startMin)}-${toTimeStr(endMin)}`;
                    }

                    newSchedule[teamRowIndex][dayStart + dayIdx] = content;

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
                curr += 30;
            }

            shuffledConfig.forEach(team => {
                const teamRowIndex = newSchedule.findIndex(r => r[0] === team.name && (!team.coach || (r[coachIndex] || '').trim() === team.coach));
                if (teamRowIndex === -1) return;

                const teamRow = newSchedule[teamRowIndex];
                const sessionsNeeded = team.sessionsPerWeek || 3;
                let sessionsScheduled = 0;

                for (let d = 0; d < 7; d++) {
                    if (teamRow[dayStart + d] && teamRow[dayStart + d].trim()) sessionsScheduled++;
                }

                let sessionsToFill = sessionsNeeded - sessionsScheduled;
                const duration = team.duration || 90;
                const blockedDays = (team.constraints || []).filter(c => c.type === 'OFF').map(c => c.day);

                for (let d = 0; d < 7 && sessionsToFill > 0; d++) {
                    if (blockedDays.includes(d)) continue;
                    if (teamRow[dayStart + d] && teamRow[dayStart + d].trim()) continue;

                    let foundSlot = false;
                    for (const loc of LOCATIONS) {
                        if (foundSlot) break;
                        for (const startMin of CANDIDATE_STARTS) {
                            const endMin = startMin + duration;
                            if (team.maxEndTime) {
                                const limit = toMin(team.maxEndTime.replace(':', ''));
                                if (endMin > limit) continue;
                            }
                            if (endMin > END_LIMIT + 60) continue;
                            if (!tryBook('HALL', loc, d, startMin, endMin)) continue;
                            if (team.coach && !tryBook('COACH', team.coach, d, startMin, endMin)) continue;

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
        currentData = [...currentData];
        currentData[rowIndex] = [...currentData[rowIndex]];
        currentData[rowIndex][colIndex] = value;
        setCurrentSchedule(currentData);
    };

    // Drag and Drop Logic
    const onDragStart = (e, rowIndex, colIndex, value) => {
        if (!value) { e.preventDefault(); return; }
        setDragStart({ rowIndex, colIndex, value });
        e.dataTransfer.effectAllowed = "move";
    };

    const onDragOver = (e) => { e.preventDefault(); };

    const onDrop = (e, targetRowIndex, targetColIndex) => {
        e.preventDefault();
        if (!dragStart) return;

        let newData = currentSchedule
            ? JSON.parse(JSON.stringify(currentSchedule))
            : JSON.parse(JSON.stringify(rawRows));

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
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload)
                });

                console.log("Payload sent to script:", payload);
                alert('הבקשה נשלחה! (בגלל מגבלות גישה, לא ניתן לקבל אישור סופי, אנא בדוק את הגיליון בעוד רגע)');
            } catch (err) {
                console.error("Save Error:", err);
                alert('שגיאה בשליחה לגיליון.');
                downloadXlsx();
            } finally {
                setIsSaving(false);
            }
        } else {
            downloadXlsx();
        }
    };

    const downloadCsv = () => {
        const csv = Papa.unparse({ fields: currentHeaders, data: dataToShow });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const blobWithBOM = new Blob(["﻿", blob], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blobWithBOM);
        link.setAttribute('href', url);
        link.setAttribute('download', 'raanana_schedule_export.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Export a full .xlsx workbook (same shape as the loaded Excel), not a flat CSV.
    const downloadXlsx = () => {
        const aoa = [currentHeaders, ...dataToShow.map((row) => row.map((c) => (c === null || c === undefined) ? '' : String(c)))];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = (currentHeaders || []).map(() => ({ wch: 18 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, (sheetName && sheetName.slice(0, 28)) || 'לו"ז');
        XLSX.writeFile(wb, 'raanana_schedule.xlsx');
    };

    const handleClear = () => {
        if (!window.confirm('לנקות את כל האימונים מהלוח? כל המשבצות יתרוקנו (אפשר לבנות מחדש או לטעון אילוצים).')) return;
        const base = JSON.parse(JSON.stringify(dataToShow || rawRows || []));
        base.forEach((row) => { for (let i = dayStart; i < dayStart + 7; i++) if (row[i] !== undefined) row[i] = ''; });
        setCurrentSchedule(base);
        setSelectedCell(null);
        setSuggestion(null);
    };

    // Load every team's constraints (from "בניית שבוע") onto the board, without auto-filling
    // the rest. Constraints win on their cell; OFF clears the day; same-day constraints stack.
    const applyConstraints = () => {
        if (!teamConfig || teamConfig.length === 0) {
            alert('לא נמצאו קבוצות/אילוצים. הגדר אותם בלשונית "בניית שבוע".');
            return;
        }
        const base = currentSchedule ? JSON.parse(JSON.stringify(currentSchedule)) : JSON.parse(JSON.stringify(rawRows));
        const tok = (t) => String(t || '').replace(':', '').padStart(4, '0');
        const written = new Set(); // cells written during THIS run → stack multiple same-day constraints
        let count = 0;

        teamConfig.forEach((team) => {
            if (!team.constraints || team.constraints.length === 0) return;
            const ri = base.findIndex(r => r[0] === team.name && (!team.coach || ((coachIndex != null && coachIndex !== -1 ? r[coachIndex] : '') || '').trim() === team.coach));
            if (ri === -1) return;

            team.constraints.forEach((c) => {
                const col = dayStart + c.day;
                const key = `${ri}_${col}`;
                if (c.type === 'OFF') { base[ri][col] = ''; written.add(key); count++; return; }

                const loc = (c.location || '').trim();
                const s = tok(c.startTime), e = tok(c.endTime);
                let content = `${loc} ${s}-${e}`.trim();
                if (c.type === 'MATCH') {
                    const where = c.subType === 'AWAY' ? 'חוץ' : (c.subType === 'HOME' ? 'בית' : '');
                    content = `🏀 משחק ${where} ${loc} ${s}-${e}`.replace(/\s+/g, ' ').trim();
                } else if (c.type === 'ATHLETICS') {
                    content = `🏃 אתלטיקה ${loc} ${s}-${e}`.trim();
                }

                base[ri][col] = written.has(key) ? `${base[ri][col]}\n${content}` : content;
                written.add(key);
                count++;
            });
        });

        if (count === 0) {
            alert('לא נמצאו אילוצים מוגדרים. הגדר אותם בלשונית "בניית שבוע".');
            return;
        }
        setCurrentSchedule(base);
        alert(`✓ נטענו ${count} אילוצים ללוח.`);
    };

    // ---- Inspector helpers ----
    // Split a cell into its individual sessions (one per non-empty line).
    const linesOf = (cellData) => (cellData || '').split('\n').map((l) => l.trim()).filter(Boolean);

    // Load a single session line into the edit fields.
    const loadLineIntoFields = (line) => {
        const range = parseTimeRangeFromText(line);
        setInspStart(range ? formatTimeToken(range.start) : '17:00');
        setInspEnd(range ? formatTimeToken(range.end) : '18:30');
        setInspHall(extractLocation(line) || '');
        setInspType(line && line.includes('משחק') ? 'MATCH' : (line && line.includes('אתלטיקה') ? 'ATHLETICS' : 'TRAIN'));
        setInspCustom('');
    };

    const selectCell = (rowIndex, colIndex, teamName, dayLabel, cellData) => {
        const lines = linesOf(cellData);
        if (lines.length > 0) { loadLineIntoFields(lines[0]); setActiveLineIndex(0); }
        else { setInspStart('17:00'); setInspEnd('18:30'); setInspHall(''); setInspType('TRAIN'); setInspCustom(''); setActiveLineIndex(-1); }
        setSelectedCell({ rowIndex, colIndex, teamName, dayLabel });
        setInspOpen(true);
    };

    // Pick an existing session in the day to edit it.
    const selectLine = (idx) => {
        if (!selectedCell) return;
        const lines = linesOf(dataToShow[selectedCell.rowIndex]?.[selectedCell.colIndex]);
        if (lines[idx] === undefined) return;
        loadLineIntoFields(lines[idx]);
        setActiveLineIndex(idx);
    };

    // Start a brand-new session in the same day (clears the fields).
    const newSession = () => {
        setInspStart('17:00'); setInspEnd('18:30'); setInspHall(''); setInspType('TRAIN'); setInspCustom('');
        setActiveLineIndex(-1);
    };

    // Build the session text from the current editor fields (returns null if times invalid).
    const buildInspContent = () => {
        const s = normalizeTimeToken(inspStart);
        const e = normalizeTimeToken(inspEnd);
        if (!s || !e || toMinutes(e) <= toMinutes(s)) {
            alert('טווח השעות לא תקין.');
            return null;
        }
        const hall = (inspHall || '').trim();
        let content = `${hall} ${s}-${e}`.trim();
        if (inspType === 'MATCH') content = `🏀 משחק ${content}`.trim();
        else if (inspType === 'ATHLETICS') content = `🏃 אתלטיקה ${content}`.trim();
        else if (inspType === 'CUSTOM' && inspCustom.trim()) content = `${inspCustom.trim()} ${content}`.trim();
        return content;
    };

    // Save the fields into ONLY the active session — replacing it if it exists, else adding it.
    // Other sessions in the same day are kept untouched.
    const saveSession = () => {
        if (!selectedCell) return;
        const content = buildInspContent();
        if (content === null) return;
        const lines = linesOf(dataToShow[selectedCell.rowIndex]?.[selectedCell.colIndex]);
        let idx = activeLineIndex;
        if (idx >= 0 && idx < lines.length) lines[idx] = content;
        else { lines.push(content); idx = lines.length - 1; }
        handleCellChange(selectedCell.rowIndex, selectedCell.colIndex, lines.join('\n'));
        setActiveLineIndex(idx);
        if (editModalOpen) setEditModalOpen(false);
    };

    // Delete one session from the day (keeps the rest).
    const deleteLine = (idx) => {
        if (!selectedCell) return;
        const lines = linesOf(dataToShow[selectedCell.rowIndex]?.[selectedCell.colIndex]);
        if (idx < 0 || idx >= lines.length) return;
        lines.splice(idx, 1);
        handleCellChange(selectedCell.rowIndex, selectedCell.colIndex, lines.join('\n'));
        if (lines.length > 0) { const ni = Math.min(idx, lines.length - 1); loadLineIntoFields(lines[ni]); setActiveLineIndex(ni); }
        else newSession();
    };

    const clearSelected = () => {
        if (!selectedCell) return;
        handleCellClear(selectedCell.rowIndex, selectedCell.colIndex);
        setInspHall('');
        setSuggestion(null);
    };

    // ---- Conflict resolution helpers ----
    const getHallCapacity = (loc) => {
        const keys = Object.keys(hallConfig || {});
        for (const k of keys) {
            if (!k) continue;
            if (loc.includes(k) || k.includes(loc)) {
                const cfg = hallConfig[k];
                if (cfg.type === 'HALF') return 2;
                if (cfg.type === 'MULTI') return Math.max(2, cfg.courts || 2);
                return 1;
            }
        }
        return 1;
    };

    const minsToTok = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;

    const findFreeHallAt = (colIndex, excludeRow, startMin, endMin) => {
        const halls = getAllKnownHalls();
        for (const hall of halls) {
            let count = 0;
            dataToShow.forEach((r, ri) => {
                if (ri === excludeRow) return;
                const cell = r?.[colIndex];
                if (!cell || typeof cell !== 'string') return;
                cell.split('\n').forEach(line => {
                    const loc = extractLocation(line);
                    if (!loc || !(loc.includes(hall) || hall.includes(loc))) return;
                    const rg = parseTimeRangeFromText(line);
                    if (rg && isOverlap(startMin, endMin, toMinutes(rg.start), toMinutes(rg.end))) count++;
                });
            });
            if (count < getHallCapacity(hall)) return hall;
        }
        return null;
    };

    const coachBusyAt = (coachName, colIndex, excludeRow, startMin, endMin) => {
        if (!coachName) return false;
        let busy = false;
        dataToShow.forEach((r, ri) => {
            if (ri === excludeRow) return;
            const cn = (coachIndex != null && coachIndex !== -1) ? (r[coachIndex] || '').trim() : '';
            if (cn !== coachName) return;
            const cell = r[colIndex];
            if (!cell || typeof cell !== 'string') return;
            cell.split('\n').forEach(line => {
                const rg = parseTimeRangeFromText(line);
                if (rg && isOverlap(startMin, endMin, toMinutes(rg.start), toMinutes(rg.end))) busy = true;
            });
        });
        return busy;
    };

    const rebuildContent = (orig, hall, startTok, endTok) => {
        const s = normalizeTimeToken(startTok);
        const e = normalizeTimeToken(endTok);
        let c = `${hall} ${s}-${e}`.trim();
        if (orig.includes('משחק')) c = `🏀 משחק ${c}`;
        else if (orig.includes('אתלטיקה')) c = `🏃 אתלטיקה ${c}`;
        return c;
    };

    // Pure: compute a fix suggestion for a conflict detail (no side effects).
    const computeSuggestion = (detail) => {
        const { rowIndex: row, colIndex: col } = detail;
        const cell = dataToShow[row]?.[col] || '';
        const range = parseTimeRangeFromText(cell);
        if (!range) return { text: 'אין שעה תקינה במשבצת — פתור ידנית.', row, col, newContent: null };

        const startMin = toMinutes(range.start);
        const endMin = toMinutes(range.end);
        const dur = endMin - startMin;

        if (detail.reason === 'אולם') {
            const hall = findFreeHallAt(col, row, startMin, endMin);
            if (hall) {
                return {
                    text: `להעביר את "${detail.team}" ל${venue()} "${hall}" באותה שעה (${formatTimeToken(range.start)}–${formatTimeToken(range.end)})`,
                    row, col, newContent: rebuildContent(cell, hall, range.start, range.end)
                };
            }
        } else { // coach
            const coachName = (coachIndex != null && coachIndex !== -1) ? (dataToShow[row]?.[coachIndex] || '').trim() : '';
            for (let s = 16 * 60; s + dur <= 22 * 60; s += 30) {
                const e = s + dur;
                if (coachBusyAt(coachName, col, row, s, e)) continue;
                const hall = findFreeHallAt(col, row, s, e);
                if (hall) {
                    return {
                        text: `להעביר את "${detail.team}" לשעה ${formatTimeToken(minsToTok(s))}–${formatTimeToken(minsToTok(e))} ב${venue()} "${hall}"`,
                        row, col, newContent: rebuildContent(cell, hall, minsToTok(s), minsToTok(e))
                    };
                }
            }
        }
        return { text: 'לא נמצא פתרון אוטומטי פנוי — פתור ידנית בעזרת הפאנל.', row, col, newContent: null };
    };

    const resolveConflict = (detail) => {
        const { rowIndex: row, colIndex: col, dayIndex } = detail;
        selectCell(row, col, detail.team, dayNameForIndex(dayIndex), dataToShow[row]?.[col] || '');
        setSuggestion(computeSuggestion(detail));
    };

    const conflictDetailFor = (rowIndex, colIndex) =>
        conflictDetails.find(c => c.rowIndex === rowIndex && c.colIndex === colIndex);

    // Right-click → "auto fix": apply the computed suggestion immediately if one exists.
    const autoFix = (rowIndex, colIndex) => {
        const detail = conflictDetailFor(rowIndex, colIndex);
        if (!detail) return;
        const sug = computeSuggestion(detail);
        if (sug.newContent) handleCellChange(rowIndex, colIndex, sug.newContent);
        else alert(sug.text);
        setCtxMenu(null);
    };

    // Right-click → "manual fix": open the editor (modal in full screen, side panel otherwise).
    const manualFix = (rowIndex, colIndex, teamName, dayLabel) => {
        selectCell(rowIndex, colIndex, teamName, dayLabel, dataToShow[rowIndex]?.[colIndex] || '');
        if (fullScreen) setEditModalOpen(true);
        setCtxMenu(null);
    };

    const applySuggestion = () => {
        if (!suggestion || !suggestion.newContent) return;
        handleCellChange(suggestion.row, suggestion.col, suggestion.newContent);
        // keep inspector synced
        const range = parseTimeRangeFromText(suggestion.newContent);
        if (range) { setInspStart(formatTimeToken(range.start)); setInspEnd(formatTimeToken(range.end)); }
        setInspHall(extractLocation(suggestion.newContent) || '');
        setSuggestion(null);
    };

    const dayNameForIndex = (dayIdx) => {
        const h = currentHeaders[dayStart + dayIdx];
        return h ? h.split(' ')[0] : DAY_NAMES[dayIdx] || '';
    };

    const knownHalls = getAllKnownHalls();
    const selectedConflicts = selectedCell
        ? conflictDetails.filter(c => c.rowIndex === selectedCell.rowIndex && c.colIndex === selectedCell.colIndex)
        : [];

    // Sessions already in the selected day (each line = one session).
    const dayLines = selectedCell ? linesOf(dataToShow[selectedCell.rowIndex]?.[selectedCell.colIndex]) : [];
    const editingExisting = activeLineIndex >= 0 && activeLineIndex < dayLines.length;

    // Shared editor body — used both in the side inspector and the full-screen modal.
    const editorFields = selectedCell ? (
        <>
            {selectedConflicts.length > 0 && (
                <div className="cc-insp-warn">
                    ⚠️ {selectedConflicts.map(c => c.reason === 'מאמן' ? `המאמן "${c.resource}" משובץ במקביל` : `ה${venue()} "${c.resource}" תפוס באותה שעה`).join(' · ')}
                    <button className="cc-btn amber full" style={{ marginTop: '0.5rem' }} onClick={() => resolveConflict(selectedConflicts[0])}>🛠 פתור אוטומטית</button>
                </div>
            )}

            {suggestion && suggestion.row === selectedCell.rowIndex && suggestion.col === selectedCell.colIndex && (
                <div className="cc-suggest">
                    <div className="cc-suggest-text">💡 {suggestion.text}{suggestion.newContent ? '?' : ''}</div>
                    <div className="cc-suggest-actions">
                        {suggestion.newContent && <button className="cc-btn green" onClick={applySuggestion}>✓ אשר תיקון</button>}
                        <button className="cc-btn ghost" onClick={() => setSuggestion(null)}>פתור ידנית</button>
                    </div>
                </div>
            )}

            {/* Sessions already in this day — tap one to edit it, 🗑 to delete just it */}
            {dayLines.length > 0 && (
                <div className="cc-field">
                    <label>אימונים ביום זה ({dayLines.length})</label>
                    <div className="cc-session-list">
                        {dayLines.map((ln, i) => (
                            <div key={i} className={`cc-session ${activeLineIndex === i ? 'on' : ''}`}>
                                <span className="cc-session-txt" onClick={() => selectLine(i)} title="ערוך אימון זה">{ln}</span>
                                <button className="cc-session-del" onClick={() => deleteLine(i)} title="מחק אימון זה">🗑</button>
                            </div>
                        ))}
                    </div>
                    <button className="cc-btn ghost full" style={{ marginTop: '0.45rem' }} onClick={newSession}>➕ אימון נוסף ליום זה</button>
                </div>
            )}

            <div className="cc-field">
                <label>{editingExisting ? `עריכת אימון ${activeLineIndex + 1}` : (dayLines.length ? 'אימון חדש' : 'פרטי האימון')} · סוג פעילות</label>
                <div className="cc-types">
                    <button className={`cc-type ${inspType === 'TRAIN' ? 'on' : ''}`} onClick={() => setInspType('TRAIN')}>אימון</button>
                    <button className={`cc-type match ${inspType === 'MATCH' ? 'on' : ''}`} onClick={() => setInspType('MATCH')}>🏀 משחק</button>
                    <button className={`cc-type ath ${inspType === 'ATHLETICS' ? 'on' : ''}`} onClick={() => setInspType('ATHLETICS')}>🏃 אתלטיקה</button>
                    <button className={`cc-type ${inspType === 'CUSTOM' ? 'on' : ''}`} onClick={() => setInspType('CUSTOM')}>✏️ אחר</button>
                </div>
            </div>

            {inspType === 'CUSTOM' && (
                <div className="cc-field">
                    <label>סוג חופשי (לדוגמה: אימון חוויה)</label>
                    <input value={inspCustom} onChange={e => setInspCustom(e.target.value)} placeholder="כתוב סוג אימון…" />
                </div>
            )}

            <div className="cc-field-row">
                <div className="cc-field"><label>משעה</label><input type="time" value={inspStart} onChange={e => setInspStart(e.target.value)} /></div>
                <div className="cc-field"><label>עד שעה</label><input type="time" value={inspEnd} onChange={e => setInspEnd(e.target.value)} /></div>
            </div>

            <div className="cc-field">
                <label>{venue()}</label>
                <input list="cc-halls" value={inspHall} onChange={e => setInspHall(e.target.value)} placeholder={`שם ${venue()}`} />
                <datalist id="cc-halls">
                    {knownHalls.map(h => <option key={h} value={h} />)}
                </datalist>
            </div>

            <button className="cc-btn blue full" onClick={() => openHallPicker(selectedCell.rowIndex, selectedCell.colIndex, selectedCell.dayLabel, selectedCell.teamName, dataToShow[selectedCell.rowIndex]?.[selectedCell.colIndex] || '')}>
                🔍 מצא {venue()} פנוי בשעה זו
            </button>

            <div className="cc-insp-actions">
                <button className="cc-btn green full" onClick={saveSession}>💾 {editingExisting ? 'עדכן אימון' : 'שמור אימון'}</button>
                {editingExisting && <button className="cc-btn danger" onClick={() => deleteLine(activeLineIndex)}>🗑 מחק</button>}
            </div>
            <button className="cc-btn ghost full" style={{ marginTop: '0.5rem' }} onClick={clearSelected}>נקה את כל היום</button>
            <p className="cc-insp-hint">כל שורה למעלה = אימון נפרד באותו יום. לחצו עליה כדי לערוך אותה, או 🗑 כדי למחוק רק אותה. "אימון נוסף ליום זה" מוסיף עוד אחד.</p>
        </>
    ) : null;

    // Empty draft → friendly message (placed AFTER all hooks so hook order is stable).
    if (!teams || teams.length === 0) {
        return (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: '2rem' }}>
                <p>אין עדיין קבוצות. הקימו קבוצות ב"👥 ניהול קבוצות" — הן יופיעו כאן כשורות ריקות מוכנות לשיבוץ.<br />
                    (אפשר גם לייבא לו"ז קיים פעם אחת ב"⚙️ הגדרות וייבוא".)</p>
            </div>
        );
    }

    return (
        <div className={`cc ${fullScreen ? 'cc--fs' : ''}`} onClick={() => ctxMenu && setCtxMenu(null)}>
            {/* Full-screen top bar */}
            {fullScreen && (
                <div className="cc-fsbar">
                    <div className="cc-fsbar-title">🏀 לו"ז שבועי — {selectedDate ? `שבוע ${selectedDate.split('-').reverse().slice(0, 2).join('/')}` : ''}
                        {draftMsg ? <span className="cc-dirty"> · {draftMsg}</span> : draftSavedAt ? <span className="cc-dirty" style={{ color: '#86efac' }}> · 💾 נשמר {draftTime}</span> : null}</div>
                    <div className="cc-actions">
                        <button className={`cc-btn ${showConflictsFS ? 'amber' : 'ghost'}`} onClick={() => setShowConflictsFS(v => !v)}>
                            {showConflictsFS ? '⚠️ מסתיר התנגשויות' : '⚠️ הצג התנגשויות'}{conflictDetails.length > 0 ? ` (${conflictDetails.length})` : ''}
                        </button>
                        <button className="cc-btn green" onClick={handleSaveDraft}>💾 שמור טיוטה</button>
                        <button className="cc-btn amber" onClick={applyConstraints}>📌 טען אילוצים</button>
                        <button className="cc-btn ghost" onClick={downloadXlsx}>⬇ ייצא אקסל</button>
                        {saveUrl && <button className="cc-btn ghost" onClick={handleSave} disabled={isSaving}>{isSaving ? 'שומר…' : '↗ לגיליון'}</button>}
                        <button className="cc-btn blue" onClick={() => { setFullScreen(false); setEditModalOpen(false); setCtxMenu(null); }}>⤢ צא ממסך מלא</button>
                    </div>
                </div>
            )}

            {/* Toolbar */}
            {!fullScreen && (
            <div className="cc-toolbar">
                <div className="cc-title">
                    🏀 לוח שיבוץ שבועי
                    {draftMsg ? <span className="cc-dirty"> · {draftMsg}</span>
                        : draftSavedAt ? <span className="cc-dirty" style={{ color: '#86efac' }}> · 💾 טיוטה נשמרה {draftTime}</span>
                            : currentSchedule ? <span className="cc-dirty"> · טיוטה לא נשמרה — לחץ "שמור טיוטה"</span> : null}
                    {draftRestored && <span className="cc-dirty" style={{ color: '#a5f3fc' }}> · המשך מטיוטה</span>}
                </div>
                <div className="cc-actions">
                    <label className="cc-date">📅 תאריך התחלה
                        <input type="date" value={selectedDate} onChange={handleDateChange} />
                    </label>
                    <button className="cc-btn blue" onClick={() => setFullScreen(true)}>🖥 עבודה על מסך מלא</button>
                    <button className="cc-btn green" onClick={handleSaveDraft}>💾 שמור טיוטה</button>
                    <button className="cc-btn amber" onClick={applyConstraints}>📌 טען אילוצים</button>
                    <button className="cc-btn amber" onClick={handleGenerate} disabled={isGenerating}>
                        {isGenerating ? 'מחשב…' : '✨ צור לו"ז אוטומטי'}
                    </button>
                    <button className="cc-btn ghost" onClick={downloadXlsx}>⬇ ייצא אקסל</button>
                    {saveUrl && (
                        <button className="cc-btn ghost" onClick={handleSave} disabled={isSaving}>
                            {isSaving ? 'שומר…' : '↗ שמור לגיליון'}
                        </button>
                    )}
                    {onDiscardDraft && <button className="cc-btn ghost" onClick={onDiscardDraft} title="מחק טיוטה וטען מחדש מהאקסל">🗑 התחל מחדש</button>}
                    <button className="cc-btn ghost" onClick={handleClear}>↺ נקה הכל</button>
                </div>
            </div>
            )}

            {/* Conflict alerts banner (hidden in full-screen — use the "show conflicts" toggle there) */}
            {!fullScreen && (conflictDetails.length > 0 ? (
                <div className="cc-alerts">
                    <div className="cc-alerts-head">⚠️ נמצאו {conflictDetails.length} התנגשויות — יש לטפל לפני שמירה</div>
                    <div className="cc-alerts-list">
                        {conflictDetails.map((c, i) => (
                            <div key={i} className="cc-alert">
                                <span className="cc-alert-info" onClick={() => selectCell(c.rowIndex, c.colIndex, c.team, dayNameForIndex(c.dayIndex), dataToShow[c.rowIndex]?.[c.colIndex] || '')}>
                                    <b>{c.team}</b> · {dayNameForIndex(c.dayIndex)} — {c.reason === 'מאמן' ? `מאמן "${c.resource}" משובץ במקביל` : `${venue()} "${c.resource}" תפוס באותה שעה`}
                                </span>
                                <button className="cc-alert-fix" onClick={() => resolveConflict(c)}>🛠 פתור</button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                dataToShow && <div className="cc-ok">✓ אין התנגשויות — הלו"ז תקין</div>
            ))}

            {/* Trainer weekly proposals are shown inside the board cells (see below), not here. */}
            {Object.keys(proposalByCell).length > 0 && (
                <div className="cc-proposal-note">📝 {Object.keys(proposalByCell).length} הצעות שיבוץ ממאמנים מסומנות בלוח (בצבע ההצעה) — לחצו על תא כדי לאמץ ולשמור.</div>
            )}

            <div className="cc-body">
                {/* Board */}
                <div className="cc-board">
                    <table className="cc-table">
                        <thead>
                            <tr>
                                <th className="cc-sticky-col">קבוצה</th>
                                {coachIndex !== undefined && coachIndex !== -1 && <th>מאמן</th>}
                                {dayHeaders.map((header, i) => (<th key={i}>{header}</th>))}
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
                                    <tr key={i}>
                                        <td className="cc-sticky-col cc-team">
                                            {teamName}
                                            {teamObj.type && (
                                                <span className="cc-gender" style={{ background: teamObj.type === 'W' ? '#be185d' : '#3b82f6' }}>{teamObj.type}</span>
                                            )}
                                        </td>
                                        {coachIndex !== undefined && coachIndex !== -1 && (
                                            <td className="cc-coach">{rowData ? rowData[coachIndex] : ''}</td>
                                        )}
                                        {dayHeaders.map((_, colMapIndex) => {
                                            const colIndex = dayStart + colMapIndex;
                                            const cellData = rowData ? rowData[colIndex] : '';
                                            const isConflict = conflictSet.has(`${rowIndex}_${colIndex}`);
                                            const isSelected = selectedCell && selectedCell.rowIndex === rowIndex && selectedCell.colIndex === colIndex;

                                            let bgColor = 'rgba(255,255,255,0.03)';
                                            let textColor = 'var(--text)';
                                            if (cellData) {
                                                const cleanLoc = cellData.replace(/\d{2}:?\d{2}.*?\d{2}:?\d{2}|\d{4}.*?\d{4}/g, '').replace(/משחק|ב-|🏀|🏃/g, '').replace('אתלטיקה', '').replace('בית', '').replace('חוץ', '').trim();
                                                const matchedLoc = hallColors && Object.keys(hallColors).find(l => (l === 'משחק' && cellData.includes('משחק')) || cleanLoc.includes(l));
                                                if (matchedLoc) bgColor = hallColors[matchedLoc];
                                                else if (cellData.includes('משחק')) bgColor = '#ffedd5';
                                                else if (cleanLoc) {
                                                    const palette = ['#fecaca', '#fde68a', '#d9f99d', '#a7f3d0', '#99f6e4', '#bae6fd', '#c7d2fe', '#ddd6fe', '#fbcfe8', '#fecdd3', '#bbf7d0', '#e9d5ff', '#a5f3fc', '#bfdbfe', '#fef08a'];
                                                    let hash = 0;
                                                    for (let k = 0; k < cleanLoc.length; k++) hash = cleanLoc.charCodeAt(k) + ((hash << 5) - hash);
                                                    bgColor = palette[Math.abs(hash) % palette.length];
                                                }
                                                textColor = '#15233f';
                                            }
                                            // In full screen the board stays clean: conflicts are only
                                            // marked (red fill + ⚠️) when "show conflicts" is toggled on.
                                            const markConflict = isConflict && (!fullScreen || showConflictsFS);
                                            // Normal view: red fill. Full screen: keep the colour, only the ⚠️ + border remain.
                                            if (markConflict && !fullScreen) { bgColor = '#fde2e4'; textColor = '#b91c1c'; }

                                            const proposalHere = proposalByCell[`${rowIndex}_${colIndex}`];
                                            const showProposal = proposalHere && !cellData; // proposal shown only on an empty cell

                                            const openCell = () => {
                                                selectCell(rowIndex, colIndex, teamName, dayHeaders[colMapIndex], cellData || '');
                                                // adopting a proposal: pre-fill the editor so "שמור אימון" commits it
                                                if (!cellData && proposalHere) loadLineIntoFields(`${proposalHere.time} ${proposalHere.loc}`.trim());
                                                if (fullScreen) setEditModalOpen(true);
                                            };
                                            const onCellContext = (e) => {
                                                e.preventDefault();
                                                setCtxMenu({ x: e.clientX, y: e.clientY, rowIndex, colIndex, teamName, dayLabel: dayHeaders[colMapIndex], isConflict });
                                            };

                                            return (
                                                <td
                                                    key={colMapIndex}
                                                    className={`cc-cell ${markConflict ? 'conflict' : ''} ${isSelected ? 'selected' : ''} ${showProposal ? 'proposal' : ''}`}
                                                    style={{ backgroundColor: bgColor, color: textColor }}
                                                    draggable={!!cellData}
                                                    onDragStart={(e) => onDragStart(e, rowIndex, colIndex, cellData)}
                                                    onDragOver={onDragOver}
                                                    onDrop={(e) => onDrop(e, rowIndex, colIndex)}
                                                    onClick={openCell}
                                                    onContextMenu={onCellContext}
                                                    title={proposalHere ? `הצעת שיבוץ של ${proposalHere.trainer} — לחצו לאימוץ` : undefined}
                                                >
                                                    {markConflict && <span className="cc-cell-warn">⚠️</span>}
                                                    {showProposal ? (
                                                        <span className="cc-cell-proposal-txt">📝 {`${proposalHere.time} ${proposalHere.loc}`.trim()}<small>הצעת {proposalHere.trainer}</small></span>
                                                    ) : (cellData
                                                        ? <span className="cc-cell-text">{cellData}</span>
                                                        : <span className="cc-cell-add">+</span>)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* collapsed: thin re-open strip so the table can use full width (not in full screen) */}
                {!fullScreen && !inspOpen && (
                    <button className="cc-insp-reopen" onClick={() => setInspOpen(true)} title="פתח פאנל עריכה">
                        ‹ עריכה
                    </button>
                )}

                {/* draggable splitter */}
                {!fullScreen && inspOpen && <div className="cc-splitter" onMouseDown={startResize} title="גרור לשינוי רוחב הפאנל">⋮</div>}

                {/* Inspector side panel (hidden in full screen — editing happens in the modal there) */}
                {!fullScreen && inspOpen && (
                <aside className="cc-inspector" style={{ width: inspWidth }}>
                    <button className="cc-insp-collapse" onClick={() => setInspOpen(false)} title="הסתר פאנל (הגדל טבלה)">⟩ הסתר</button>
                    {!selectedCell ? (
                        <div className="cc-insp-empty">
                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎯</div>
                            לחץ על משבצת בלוח כדי להוסיף או לערוך אימון
                        </div>
                    ) : (
                        <>
                            <h3 className="cc-insp-title">{selectedCell.teamName}</h3>
                            <div className="cc-insp-sub">יום {selectedCell.dayLabel}</div>
                            {editorFields}
                        </>
                    )}
                </aside>
                )}
            </div>

            {/* Full-screen edit modal */}
            {fullScreen && editModalOpen && selectedCell && (
                <div className="cc-modal-overlay" onClick={() => setEditModalOpen(false)}>
                    <div className="cc-modal cc-edit-modal" onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                            <h4 style={{ margin: 0 }}>{selectedCell.teamName} · יום {selectedCell.dayLabel}</h4>
                            <button onClick={() => setEditModalOpen(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text)' }}>✕</button>
                        </div>
                        {editorFields}
                    </div>
                </div>
            )}

            {/* Right-click context menu (auto / manual fix) */}
            {ctxMenu && (
                <div className="cc-ctx" style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={(e) => e.stopPropagation()}>
                    {ctxMenu.isConflict && (
                        <button onClick={() => autoFix(ctxMenu.rowIndex, ctxMenu.colIndex)}>🛠 תיקון אוטומטי</button>
                    )}
                    <button onClick={() => manualFix(ctxMenu.rowIndex, ctxMenu.colIndex, ctxMenu.teamName, ctxMenu.dayLabel)}>✏️ תיקון ידני</button>
                    <button onClick={() => setCtxMenu(null)}>✕ סגור</button>
                </div>
            )}

            {/* Hall picker modal (kept) */}
            {isHallPickerOpen && hallPickerTarget && (
                <div className="cc-modal-overlay">
                    <div className="cc-modal">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0 }}>בחירת {venue()} פנוי</h4>
                            <button onClick={closeHallPicker} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text)' }}>✕</button>
                        </div>
                        <div style={{ marginTop: '0.6rem', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                            <strong>קבוצה:</strong> {hallPickerTarget.teamName} | <strong>יום:</strong> {hallPickerTarget.dayLabel}
                        </div>
                        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <label style={{ fontSize: '0.9rem' }}>משעה:</label>
                            <input type="time" value={hallStartTime} onChange={(e) => setHallStartTime(e.target.value)} className="cc-time" />
                            <label style={{ fontSize: '0.9rem' }}>עד שעה:</label>
                            <input type="time" value={hallEndTime} onChange={(e) => setHallEndTime(e.target.value)} className="cc-time" />
                        </div>
                        <div style={{ marginTop: '1rem' }}>
                            <h5 style={{ margin: '0 0 0.5rem 0', color: '#34d399' }}>{venues()} פנויים ({hallAvailability.available.length})</h5>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {hallAvailability.available.map((item) => (
                                    <button key={item.hall} onClick={() => applyHallToTargetCell(item.hall)} className="cc-hall-free">{item.hall}</button>
                                ))}
                                {hallAvailability.available.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>אין {venues()} פנויים בטווח שנבחר.</div>}
                            </div>
                        </div>
                        <div style={{ marginTop: '1rem' }}>
                            <h5 style={{ margin: '0 0 0.5rem 0', color: '#fbbf24' }}>{venues()} תפוסים ({hallAvailability.unavailable.length})</h5>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {hallAvailability.unavailable.map((item) => (
                                    <div key={item.hall} className="cc-hall-busy"><strong>{item.hall}</strong> — {item.reason}</div>
                                ))}
                                {hallAvailability.unavailable.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>אין התנגשויות ידועות בטווח.</div>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Preview;
