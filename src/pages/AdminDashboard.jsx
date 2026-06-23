import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import WeekBuilder from '../components/WeekBuilder';
import Preview from '../components/Preview';
import HallsConfig from '../components/HallsConfig';
import FloatingMessage from '../components/FloatingMessage';
import MessageCenter from '../components/MessageCenter';
import InviteLinks from '../components/InviteLinks';
import TrainerManager from '../components/TrainerManager';
import PublishPanel from '../components/PublishPanel';
import ApprovalsPanel from '../components/ApprovalsPanel';
import { getActiveClub } from '../clubConfig.js';
import { subscribeToPush } from '../push.js';
import { authHeaders } from '../adminApi.js';
import { sessionsToSheet, sheetToSessions } from '../draftBridge.js';

const AdminDashboard = () => {
    const navigate = useNavigate();
    const club = getActiveClub(); // dashboard is scoped to the club in the URL
    const [activeTab, setActiveTab] = useState('preview'); // land straight on the working board
    const mqMobile = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
    const [isMobile, setIsMobile] = useState(mqMobile);
    const [sidebarOpen, setSidebarOpen] = useState(() => !mqMobile()); // closed by default on phones

    // Setup state — per-club "temporary Excel" (draft sheet) + its save API.
    const [sheetUrl, setSheetUrl] = useState(club.publishUrl || club.dataUrl || '');
    const [saveUrl, setSaveUrl] = useState(club.sheetApi || '');
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
    const [hallConfig, setHallConfig] = useState({});
    const [pw, setPw] = useState({ cur: '', next: '', confirm: '' });
    const [pwMsg, setPwMsg] = useState('');

    const changePassword = async () => {
        if (!pw.cur || !pw.next) { setPwMsg('מלא סיסמה נוכחית וחדשה'); return; }
        if (pw.next !== pw.confirm) { setPwMsg('הסיסמה החדשה ואישורה אינם תואמים'); return; }
        setPwMsg('משנה…');
        try {
            const r = await fetch(`/api/${club.slug}/managers/password`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(club.slug) },
                body: JSON.stringify({ currentPassword: pw.cur, newPassword: pw.next }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) { setPwMsg('✓ הסיסמה עודכנה'); setPw({ cur: '', next: '', confirm: '' }); }
            else setPwMsg('❌ ' + (d.error || 'שינוי נכשל'));
        } catch { setPwMsg('שגיאת תקשורת'); }
        setTimeout(() => setPwMsg(''), 5000);
    };

    // ---- Draft schedule — lives in the DB (status='draft'); the preview reads/writes it ----
    const DRAFT_KEY = `draft:${club.slug}`;        // instant local cache (crash safety only)
    const latestDraft = useRef(null);              // { headers, rows } reported by the Preview on edit
    const saveTimer = useRef(null);                // debounce handle for auto-save to DB
    const [draftSavedAt, setDraftSavedAt] = useState(null);
    const [draftRestored, setDraftRestored] = useState(false);
    const sheetDataRef = useRef(null);             // mirror of {teams, indices, hallColors, weekStart}

    // Track viewport so the dashboard becomes a phone-friendly layout (drawer sidebar).
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const onChange = () => { setIsMobile(mq.matches); setSidebarOpen(!mq.matches); };
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    // Pick a tab and, on mobile, close the drawer so the content is visible.
    const selectTab = (tab) => { setActiveTab(tab); if (mqMobile()) setSidebarOpen(false); };

    // (teamConfig/rules are loaded inside loadDraft, merged with the draft teams,
    //  to avoid a race where two effects clobber each other.)

    // Load hall config on mount
    useEffect(() => {
        const saved = localStorage.getItem('raananaHallConfig');
        if (saved) {
            try { setHallConfig(JSON.parse(saved) || {}); } catch (e) { /* ignore */ }
        }
    }, []);

    // Save hall config on change
    useEffect(() => {
        localStorage.setItem('raananaHallConfig', JSON.stringify(hallConfig));
    }, [hallConfig]);

    // Keep a ref in sync so draft callbacks can read the latest sheetData.
    useEffect(() => { sheetDataRef.current = sheetData; }, [sheetData]);

    // Load hall settings (capacity + per-hall colour) from the DB so the preview uses them.
    useEffect(() => {
        fetch(`/api/${club.slug}/halls`).then((r) => r.json())
            .then((d) => { if (d && d.config) setHallConfig((prev) => ({ ...prev, ...d.config })); })
            .catch(() => {});
    }, [club.slug]);

    // Per-hall colours chosen in "הגדרת אולמות" override the auto palette in the preview.
    const hallColorOverrides = Object.fromEntries(
        Object.entries(hallConfig || {}).filter(([, v]) => v && v.color).map(([k, v]) => [k, v.color]),
    );

    // Load the DB draft → populate the preview (sheet-shaped) + WeekBuilder teams.
    const loadDraft = async ({ silent } = {}) => {
        try {
            // load the draft AND the saved scheduling rules together (single source → no race)
            const [draftR, rulesR] = await Promise.all([
                fetch(`/api/${club.slug}/draft`, { headers: authHeaders(club.slug) }),
                fetch(`/api/${club.slug}/settings/teamRules`).then((x) => x.json()).catch(() => ({})),
            ]);
            if (!draftR.ok) return;
            const draft = await draftR.json();
            const sheet = sessionsToSheet(draft);
            setSheetData({ headers: sheet.headers, teams: sheet.teams, rawRows: sheet.rawRows, hallColors: sheet.hallColors, indices: sheet.indices });
            setCurrentSchedule(sheet.rawRows);
            setSheetName('draft');
            sheetDataRef.current = { teams: sheet.teams, indices: sheet.indices, hallColors: sheet.hallColors, weekStart: sheet.weekStart };
            latestDraft.current = { headers: sheet.headers, rows: sheet.rawRows };
            setIsConnected(true);
            if (!silent) setDraftRestored((draft.sessions || []).length > 0);
            // teamConfig = draft teams (with their saved rules merged) + rules-only teams.
            const saved = Array.isArray(rulesR.value) ? rulesR.value : [];
            const byKey = {}; saved.forEach((t) => { byKey[`${t.name}|${t.coach || ''}`] = t; });
            const draftKeys = new Set(sheet.teams.map((t) => `${t.name}|${t.coach || ''}`));
            const fromDraft = sheet.teams.map((t) => {
                const s = byKey[`${t.name}|${t.coach || ''}`];
                return s ? { ...s, type: t.type } : { name: t.name, coach: t.coach, type: t.type, sessionsPerWeek: 3, constraints: [] };
            });
            const rulesOnly = saved.filter((t) => !draftKeys.has(`${t.name}|${t.coach || ''}`));
            setTeamConfig([...fromDraft, ...rulesOnly]);
        } catch { /* offline */ }
    };

    // Convert the current preview rows → sessions and PUT them to the DB draft.
    const saveDraftToDB = async () => {
        const sd = sheetDataRef.current; const d = latestDraft.current;
        if (!sd || !d) return { ok: false };
        const sessions = sheetToSessions(d.headers, d.rows, sd.indices, sd.teams, sd.weekStart);
        try {
            const r = await fetch(`/api/${club.slug}/draft`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(club.slug) },
                body: JSON.stringify({ sessions, weekStart: sd.weekStart }),
            });
            if (!r.ok) throw new Error('save failed');
            setDraftSavedAt(Date.now());
            return { ok: true };
        } catch (e) { console.error('draft save error', e); return { ok: false }; }
    };

    // Preview reports edits → instant local cache (crash safety) + debounced DB save.
    const handlePreviewChange = (payload) => {
        latestDraft.current = payload;
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...payload, ws: sheetDataRef.current?.weekStart, ts: Date.now() })); } catch { /* quota */ }
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => { saveDraftToDB(); }, 2500);
    };

    const discardDraft = async () => {
        if (!window.confirm('לרוקן את הטיוטה הנוכחית ולהתחיל מחדש? (הלוז החי שכבר פורסם להורים לא יושפע.)')) return;
        await fetch(`/api/${club.slug}/draft`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(club.slug) },
            body: JSON.stringify({ sessions: [] }),
        }).catch(() => {});
        localStorage.removeItem(DRAFT_KEY);
        loadDraft();
    };

    // On mount: load the draft from the DB so the manager continues where they left off.
    useEffect(() => {
        loadDraft();
        return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [club.slug]);

    const handleLogout = () => {
        localStorage.removeItem('isAdmin');
        navigate(`/${club.slug}/admin`);
    };

    // Subscribe THIS device to manager push (approve/reject from the notification).
    const enableManagerPush = async () => {
        const r = await subscribeToPush('__MANAGER__');
        alert(r.ok ? '🔔 התראות מנהל הופעלו במכשיר זה' : 'לא הופעל: ' + (r.reason || 'דפדפן לא נתמך / נדרש build'));
    };

    const handleClearRules = () => {
        if (window.confirm("Are you sure you want to clear all saved rules (constraints)?")) {
            setTeamConfig([]);
            fetch(`/api/${club.slug}/settings/teamRules`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders(club.slug) },
                body: JSON.stringify({ value: [] }),
            }).catch(() => {});
            alert("Rules cleared.");
        }
    };

    const extractSheetId = (url) => {
        const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    };

    // WeekBuilder constraints are stored per-club in the DB (club_settings/teamRules).
    const loadRulesFromCloud = async () => {
        try {
            const r = await fetch(`/api/${club.slug}/settings/teamRules`);
            const d = await r.json();
            if (Array.isArray(d.value) && d.value.length) {
                const map = {};
                d.value.forEach((t) => { map[`${t.name}_${t.coach || ''}`] = t; });
                return map;
            }
        } catch { /* none yet */ }
        return null;
    };

    const saveRulesToCloud = async (currentConfig) => {
        if (!currentConfig) return;
        try {
            const r = await fetch(`/api/${club.slug}/settings/teamRules`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders(club.slug) },
                body: JSON.stringify({ value: currentConfig }),
            });
            if (!r.ok) throw new Error('save failed');
            alert('החוקים נשמרו ל-DB בהצלחה!');
        } catch (e) {
            console.error('Save rules error:', e);
            alert('שגיאה בשמירת החוקים.');
        }
    };

    // Import a Google Sheet / CSV URL into the DB draft, then load it into the preview.
    const handleConnect = async () => {
        setLoading(true); setError('');
        const id = extractSheetId(sheetUrl);
        let csvUrl;
        if (id) csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0`;
        else if (/\.csv(\?|$)/i.test(sheetUrl) || sheetUrl.startsWith('/')) csvUrl = sheetUrl;
        else { setError('מקור לא תקין — הזן קישור Google Sheet או קובץ CSV.'); setLoading(false); return; }
        try {
            const response = await fetch(csvUrl);
            if (!response.ok) throw new Error('שגיאה בטעינת הגיליון — ודא שהוא משותף/פומבי.');
            const csv = await response.text();
            await importCsvToDraft(csv);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // POST CSV text → the DB draft, then refresh the preview from the draft.
    const importCsvToDraft = async (csv) => {
        const r = await fetch(`/api/${club.slug}/draft/import`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(club.slug) },
            body: JSON.stringify({ csv }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'ייבוא נכשל');
        await loadDraft();
        setActiveTab('preview');
    };

    // Read an uploaded Excel/CSV file in the browser → CSV text → import to the draft.
    const handleImportFile = async (file) => {
        if (!file) return;
        setLoading(true); setError('');
        try {
            let csv;
            if (/\.csv$/i.test(file.name)) {
                csv = await file.text();
            } else {
                const XLSX = await import('xlsx');
                const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
                csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
            }
            await importCsvToDraft(csv);
        } catch (err) {
            setError('ייבוא נכשל: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    // (legacy inline-parse path kept below but unused; superseded by DB draft import)
    const handleConnectLegacy = async () => {
        const cloudRulesMap = null;
        const sheetUrlLegacy = sheetUrl;
        const id = extractSheetId(sheetUrlLegacy);
        let csvUrl = id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=0` : sheetUrlLegacy;
        try {
            const response = await fetch(csvUrl);
            if (!response.ok) throw new Error('x');
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
                    <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
                        <h3 style={{ marginTop: 0 }}>טעינת לוז ראשוני (אופציונלי)</h3>
                        <p style={{ color: '#666', maxWidth: 680 }}>
                            הלוז נשמר ב‑DB. אפשר לבנות אותו מאפס ב<b>תצוגה מקדימה</b>, או לטעון לוז קיים פעם אחת —
                            מקובץ <b>אקסל/CSV</b> או מקישור Google Sheet. הטעינה ממלאה את <b>טיוטת שבוע הבא</b> (לא את הלוז החי).
                        </p>

                        <div style={{ display: 'flex', gap: '0.8rem', marginTop: '1.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <label style={{ background: '#0891b2', color: 'white', padding: '0.7rem 1.2rem', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold' }}>
                                {loading ? 'טוען…' : '⬆ טען קובץ אקסל / CSV'}
                                <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                                    onChange={(e) => { handleImportFile(e.target.files[0]); e.target.value = ''; }} />
                            </label>
                            <span style={{ color: '#94a3b8' }}>או</span>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.8rem', flexWrap: 'wrap' }}>
                            <input
                                type="text"
                                value={sheetUrl}
                                onChange={(e) => setSheetUrl(e.target.value)}
                                placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv..."
                                style={{ flex: 1, minWidth: 240, padding: '0.8rem', borderRadius: '4px', border: '1px solid #ddd', background: '#fff', color: '#374151', direction: 'ltr' }}
                            />
                            <button
                                onClick={handleConnect}
                                disabled={loading}
                                style={{ background: '#2563eb', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                {loading ? 'טוען...' : 'ייבא מקישור Google Sheet'}
                            </button>
                        </div>

                        {error && <div style={{ color: '#ef4444', marginTop: '1rem', background: '#fee2e2', padding: '1rem', borderRadius: '4px' }}>{error}</div>}
                        <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#4b5563' }}>
                            לעריכה ופרסום — עברו ל<b>תצוגה מקדימה</b> ואז <b>פרסם לוז</b>.
                        </div>

                        <div style={{ marginTop: '1.5rem', padding: '0.9rem 1rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, color: '#1e3a8a', fontSize: '0.9rem', lineHeight: 1.6 }}>
                            ℹ️ הלו"ז עובד מול מסד הנתונים. ייבוא נדרש רק <b>פעם אחת</b> כשמתחילים — אחר כך
                            בונים ומפרסמים מתוך <b>בניית הלו"ז</b>. אין צורך בחיבור/שמירה לגיליון חיצוני.
                        </div>

                        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e5e7eb', paddingTop: '1.2rem' }}>
                            <h4 style={{ margin: '0 0 0.3rem' }}>🔑 שינוי סיסמת מנהל</h4>
                            <p style={{ color: '#666', fontSize: '0.85rem', margin: '0 0 0.7rem' }}>שכחת סיסמה? פנה למנהל‑העל לאיפוס.</p>
                            <div style={{ display: 'grid', gap: '0.6rem', maxWidth: 360 }}>
                                <input type="password" placeholder="סיסמה נוכחית" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} style={{ padding: '0.7rem', borderRadius: 8, border: '1px solid #ddd', direction: 'ltr' }} />
                                <input type="password" placeholder="סיסמה חדשה" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} style={{ padding: '0.7rem', borderRadius: 8, border: '1px solid #ddd', direction: 'ltr' }} />
                                <input type="password" placeholder="אישור סיסמה חדשה" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} style={{ padding: '0.7rem', borderRadius: 8, border: '1px solid #ddd', direction: 'ltr' }} />
                                <button onClick={changePassword} style={{ background: '#0891b2', color: '#fff', border: 'none', padding: '0.7rem', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>עדכן סיסמה</button>
                                {pwMsg && <div style={{ fontWeight: 'bold', color: pwMsg.startsWith('✓') ? '#16a34a' : '#ef4444' }}>{pwMsg}</div>}
                            </div>
                        </div>
                    </div>
                );
            case 'weekBuilder':
                return (
                    <div className="report-panel" style={{ display: 'flex', flexDirection: 'column', color: '#0f1b33', marginTop: 0 }}>
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
                        sheetId={extractSheetId(sheetUrl)}
                        indices={sheetData?.indices}
                        currentSchedule={currentSchedule}
                        setCurrentSchedule={setCurrentSchedule}
                        hallColors={{ ...(sheetData?.hallColors || {}), ...hallColorOverrides }}
                        hallConfig={hallConfig}
                        clubSlug={club.slug}
                        onChange={handlePreviewChange}
                        onSaveDraft={saveDraftToDB}
                        onDiscardDraft={discardDraft}
                        draftSavedAt={draftSavedAt}
                        draftRestored={draftRestored}
                    />
                );
            case 'halls':
                return <HallsConfig clubSlug={getActiveClub().slug} />;
            case 'messages':
                return <FloatingMessage clubSlug={getActiveClub().slug} />;
            case 'trainerPush':
                return <MessageCenter />;
            case 'invites':
                return <InviteLinks />;
            case 'trainersAdmin':
                return <TrainerManager />;
            case 'publish':
                return <PublishPanel clubSlug={getActiveClub().slug} />;
            case 'approvals':
                return <ApprovalsPanel clubSlug={getActiveClub().slug} />;
            default:
                return null;
        }
    };

    return (
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'transparent', fontFamily: 'Rubik, sans-serif', color: 'var(--text)' }}>
            {/* Header */}
            <header style={{ background: 'rgba(7,11,22,0.62)', backdropFilter: 'blur(20px) saturate(1.4)', padding: isMobile ? '0.6rem 0.8rem' : '0.9rem 2rem', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '0.6rem' : '1.2rem', minWidth: 0 }}>
                    <button
                        onClick={() => setSidebarOpen(o => !o)}
                        title={sidebarOpen ? 'הסתר תפריט' : 'הצג תפריט'}
                        style={{ background: 'var(--glass-2)', color: 'var(--text)', border: '1px solid var(--glass-border)', width: '40px', height: '40px', borderRadius: '11px', cursor: 'pointer', fontSize: '1.1rem', flexShrink: 0 }}
                    >☰</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', minWidth: 0 }}>
                        <img src="/men_logo.png" alt="Logo" style={{ height: isMobile ? '36px' : '48px', width: 'auto', borderRadius: '12px', background: '#fff', padding: '3px', flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ margin: 0, color: 'var(--text)', fontSize: isMobile ? '0.95rem' : '1.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isMobile ? 'ניהול המועדון' : 'מערכת ניהול · פורטל ראשי'}</h2>
                            {!isMobile && <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>ניהול גברים ונשים (משותף)</span>}
                        </div>
                    </div>
                </div>


                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '0.4rem' : '1rem', flexShrink: 0 }}>
                    {!isMobile && <a href="/" target="_blank" style={{ textDecoration: 'none', color: 'var(--sky)', fontSize: '0.9rem', fontWeight: 600 }}>פתח אתר 🔗</a>}
                    {!isMobile && <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>שלום, Admin</span>}
                    <button
                        onClick={enableManagerPush}
                        title="קבל התראות על בקשות שינוי ואשר ישירות מההתראה"
                        style={{ background: 'var(--glass-bg)', color: 'var(--text)', border: '1px solid var(--glass-border)', padding: isMobile ? '0.45rem 0.6rem' : '0.5rem 0.9rem', borderRadius: '10px', cursor: 'pointer', fontFamily: 'Rubik, sans-serif', fontSize: isMobile ? '0.85rem' : '1rem', whiteSpace: 'nowrap' }}
                    >
                        🔔{isMobile ? '' : ' התראות מנהל'}
                    </button>
                    <button
                        onClick={handleLogout}
                        style={{ background: 'var(--glass-bg)', color: 'var(--text)', border: '1px solid var(--glass-border)', padding: isMobile ? '0.45rem 0.6rem' : '0.5rem 1rem', borderRadius: '10px', cursor: 'pointer', fontFamily: 'Rubik, sans-serif', fontSize: isMobile ? '0.85rem' : '1rem', whiteSpace: 'nowrap' }}
                    >
                        {isMobile ? 'יציאה' : 'התנתק'}
                    </button>
                </div>
            </header >

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                {/* Mobile drawer backdrop */}
                {isMobile && sidebarOpen && (
                    <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, top: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} />
                )}
                {/* Sidebar — inline column on desktop, fixed drawer on mobile */}
                {sidebarOpen && <aside style={isMobile
                    ? { position: 'fixed', top: 0, right: 0, bottom: 0, width: '76vw', maxWidth: '300px', zIndex: 50, background: 'rgba(10,17,32,0.98)', backdropFilter: 'blur(16px)', borderLeft: '1px solid var(--glass-border)', padding: '1.2rem 0', overflowY: 'auto', boxShadow: '-20px 0 60px -10px rgba(0,0,0,0.7)' }
                    : { width: '230px', flexShrink: 0, background: 'rgba(7,11,22,0.45)', backdropFilter: 'blur(14px)', borderLeft: '1px solid var(--glass-border)', padding: '2rem 0' }}>
                    <nav style={{ display: 'flex', flexDirection: 'column' }}>
                        <button style={menuButtonStyle(activeTab === 'preview')} onClick={() => selectTab('preview')}>
                            👁️ בניית הלו"ז (טיוטה)
                        </button>
                        <button style={menuButtonStyle(activeTab === 'publish')} onClick={() => selectTab('publish')}>
                            🚀 פרסם לוז
                        </button>
                        <button style={menuButtonStyle(activeTab === 'approvals')} onClick={() => selectTab('approvals')}>
                            ✅ בקשות לאישור
                        </button>
                        <button style={menuButtonStyle(activeTab === 'weekBuilder')} onClick={() => selectTab('weekBuilder')}>
                            📅 חוקי שיבוץ
                        </button>
                        <button style={menuButtonStyle(activeTab === 'halls')} onClick={() => selectTab('halls')}>
                            🏟️ אולמות
                        </button>
                        <button style={menuButtonStyle(activeTab === 'messages')} onClick={() => selectTab('messages')}>
                            📣 הודעה צפה
                        </button>
                        <button style={menuButtonStyle(activeTab === 'trainerPush')} onClick={() => selectTab('trainerPush')}>
                            📢 הודעות
                        </button>
                        <button style={menuButtonStyle(activeTab === 'invites')} onClick={() => selectTab('invites')}>
                            🔗 לינקי הזמנה
                        </button>
                        <button style={menuButtonStyle(activeTab === 'trainersAdmin')} onClick={() => selectTab('trainersAdmin')}>
                            👤 ניהול מאמנים
                        </button>
                        <button style={menuButtonStyle(activeTab === 'setup')} onClick={() => selectTab('setup')}>
                            ⚙️ הגדרות וייבוא
                        </button>
                    </nav>
                </aside>}

                {/* Content Area */}
                <main style={{ flex: 1, minWidth: 0, padding: '1rem', overflowY: 'auto' }}>
                    {renderContent()}
                </main>
            </div>
        </div >
    );
};

const menuButtonStyle = (isActive) => ({
    background: isActive ? 'rgba(255,122,24,0.14)' : 'transparent',
    color: isActive ? '#ff9d3c' : 'rgba(238,242,251,0.7)',
    border: 'none',
    borderRight: isActive ? '4px solid #ff7a18' : '4px solid transparent', // Adjusted for RTL
    padding: '1rem 1.5rem',
    textAlign: 'right', // Adjusted for RTL
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: isActive ? 700 : 500,
    display: 'flex',
    alignItems: 'center',
    gap: '0.8rem',
    marginBottom: '0.2rem',
    fontFamily: 'Rubik, sans-serif'
});

export default AdminDashboard;


