import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Link, useNavigate } from 'react-router-dom';
import '../App.css';
import { flattenScheduleData, exportToExcel, parseHeaderDate, parseTime, createICSFile, parseCellContent, sessionsToRows } from '../utils/scheduleUtils';
import LeagueGamesBanner from '../components/LeagueGamesBanner';
import HallView from '../components/HallView';
import DailyView from '../components/DailyView';
import TrainerEditModal from '../components/TrainerEditModal'; // Import the Modal
import RegisterUpdatesModal from '../components/RegisterUpdatesModal';
import NavButton from '../components/NavButton';
import CalendarSubscribe from '../components/CalendarSubscribe';
import { useI18n, LanguageSwitcher } from '../i18n.jsx';
import { getActiveClub } from '../clubConfig.js';
import { sportEmoji } from '../sportLabels.js';
import { getIdentity } from '../userIdentity.js';

// Alias for compatibility if needed, or just use parseCellContent directly
const parseScheduleContent = parseCellContent;

function PublicSchedule() {
    // Data sources come from the active club (resolved from the URL path).
    const club = getActiveClub();
    const LIVE_SHEET_API = club.sheetApi;
    const DATA_URL = club.dataUrl;

    // A "member" (parent/trainee via invite) is locked to their own team; an operator/
    // manager sees the full board. memberTeam is empty for non-members.
    const identity = getIdentity();
    const memberTeam = identity.role === 'member' ? identity.team : '';

    // Who is this device? Members are locked to their team; operators/managers/trainers
    // get the full board. Anyone the system doesn't recognise is "anonymous" — they see
    // an explainer with a link to the product page, not the club's schedule.
    const isAdmin = localStorage.getItem('isAdmin') === 'true';
    const isTrainer = !!localStorage.getItem('trainerToken');
    const isAnonymous = !memberTeam && identity.role !== 'operator' && !isAdmin && !isTrainer;

    // The installed PWA always opens at /<club> (the fixed manifest start_url), so we route
    // by how the device joined: a trainer (logged in, or installed from the trainer link)
    // lands in the trainer portal; a registered member stays on their team; everyone else
    // sees the welcome. The "לוח ההורים" link carries ?view=parent to opt out of the bounce.
    const navigate = useNavigate();
    const viewParent = new URLSearchParams(window.location.search).get('view') === 'parent';
    const entryRole = localStorage.getItem('entryRole');
    const entryTeam = localStorage.getItem('entryTeam');
    useEffect(() => {
        // Already registered (member/operator) or explicitly viewing the parent board → stay put.
        if (viewParent || memberTeam || identity.role === 'operator') return;
        if (isTrainer || entryRole === 'trainer') { navigate(`/${club.slug}/trainer`, { replace: true }); return; }
        // Came in via a parent/operator invite but haven't registered yet → open that registration.
        if (entryRole === 'member' && entryTeam) { navigate(`/${club.slug}/join?r=member&team=${encodeURIComponent(entryTeam)}`, { replace: true }); return; }
        if (entryRole === 'operator') { navigate(`/${club.slug}/join?r=operator`, { replace: true }); return; }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Per-club brand logo (falls back to the PWA icon, then the built-in crest).
    const clubLogo = club.logo || club.icon512 || club.icon192 || '/men_logo.png';
    // Header display name: drop any " — …" suffix (e.g. 'עירוני רעננה — לו"ז' -> 'עירוני רעננה').
    const clubBrandName = (club.name || '').split('—')[0].trim() || club.name;

    const [locations, setLocations] = useState([]); // Store active halls for dropdown
    const [data, setData] = useState([]);
    const [teams, setTeams] = useState([]); // Array of objects
    const [headers, setHeaders] = useState([]);
    const [dayStart, setDayStart] = useState(1);

    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [floatingMsg, setFloatingMsg] = useState(null);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('team'); // 'team' or 'halls'
    const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedSessionForEdit, setSelectedSessionForEdit] = useState(null);
    const { t, localizeDay, localizeHall } = useI18n();

    useEffect(() => {
        // Shared: take an array-of-arrays sheet model (from the DB or from CSV) and
        // populate all the view state. Identical logic for both data sources.
        const processRows = (rows) => {
            let headerRowIndex = -1;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i][0] && rows[i][0].includes('קבוצות')) { headerRowIndex = i; break; }
            }
            if (headerRowIndex === -1) return;

            const headerRow = rows[headerRowIndex];
            const dataRows = rows.slice(headerRowIndex + 1);

            // Dynamic Column Detection
            const teamIndex = 0;
            let coachIndex = headerRow.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach') || h.toLowerCase().includes('trainer')));
            let typeIndex = headerRow.findIndex(h => h && (h.toLowerCase() === 'type' || h.includes('סוג') || h.includes('מגדר')));
            let dayStartIndex = headerRow.findIndex(h => h && h.includes('ראשון'));
            if (dayStartIndex === -1) {
                dayStartIndex = (coachIndex !== -1) ? coachIndex + 1 : 1;
            }
            setDayStart(dayStartIndex);

            // Extract Halls
            const locSet = new Set();
            dataRows.forEach(r => {
                for (let d = dayStartIndex; d < dayStartIndex + 7; d++) {
                    const c = r[d];
                    if (c && c.trim() && !c.toLowerCase().includes('xxx')) {
                        c.split('\n').forEach(p => {
                            const { location } = parseCellContent(p);
                            if (location && location.trim().length > 1) locSet.add(location.trim());
                        });
                    }
                }
            });
            setLocations(Array.from(locSet).sort());

            // Extract teams with unique identifiers
            const teamObjects = [];
            dataRows.forEach((row, rowIndex) => {
                const name = row[teamIndex];
                if (!name || name.trim() === '') return;
                if (['באנר', 'banner'].some(b => name.trim().toLowerCase().includes(b))) return;

                const typeVal = (typeIndex !== -1 && row[typeIndex]) ? row[typeIndex].trim().toUpperCase() : 'M';
                const coach = (coachIndex !== -1) ? row[coachIndex] : '';
                const label = coach ? `${name} - ${coach}` : name;
                const absoluteRow = headerRowIndex + 2 + rowIndex;

                teamObjects.push({
                    label, value: rowIndex.toString(), name: name.trim(),
                    coach: coach ? coach.trim() : '', type: typeVal,
                    row, rowIndex, absoluteRow,
                });
            });

            setHeaders(headerRow);
            setTeams(teamObjects);
            setData(dataRows);

            const menTeams = teamObjects.filter(t => t.type !== 'W');
            const urlParams = new URLSearchParams(window.location.search);
            const sharedTeam = urlParams.get('team');
            let defaultTeamId = '';
            if (memberTeam) {
                const found = teamObjects.find(t => t.label === memberTeam || t.name === memberTeam);
                if (found) defaultTeamId = found.value;
            }
            if (!defaultTeamId && sharedTeam) {
                const found = teamObjects.find(t => t.label === sharedTeam || t.name === sharedTeam);
                if (found) defaultTeamId = found.value;
            }
            if (!defaultTeamId && !memberTeam && menTeams.length > 0) {
                defaultTeamId = menTeams[0].value;
            }
            setSelectedTeamId(defaultTeamId);
        };

        const fetchData = async () => {
            try {
                // 1) Prefer the DB-backed live schedule (published via the manager screen).
                try {
                    const apiRes = await fetch(`/api/${club.slug}/schedule`);
                    if (apiRes.ok) {
                        const payload = await apiRes.json();
                        if (payload && Array.isArray(payload.sessions) && payload.sessions.length) {
                            processRows(sessionsToRows(payload.sessions, payload.publication?.week_start));
                            setLoading(false);
                            return;
                        }
                    }
                } catch { /* DB/API unavailable — fall back to CSV */ }

                // 2) Fallback: the live Google Sheet CSV (legacy / not-yet-published clubs).
                const response = await fetch(DATA_URL);
                const reader = response.body.getReader();
                const result = await reader.read();
                const decoder = new TextDecoder('utf-8');
                const csv = decoder.decode(result.value);
                Papa.parse(csv, {
                    header: false,
                    complete: (results) => { processRows(results.data); setLoading(false); },
                    error: (error) => { console.error('Error parsing CSV:', error); setLoading(false); },
                });
            } catch (error) {
                console.error('Error fetching data:', error);
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    // Club settings: floating banner + hall addresses (bridged to localStorage for nav).
    useEffect(() => {
        fetch(`/api/${club.slug}/settings/floatingMessage`).then((r) => r.json())
            .then((d) => setFloatingMsg(d.value || null)).catch(() => { });
        fetch(`/api/${club.slug}/halls`).then((r) => r.json())
            .then((d) => { if (d.config) localStorage.setItem(`hallcfg:${club.slug}`, JSON.stringify(d.config)); })
            .catch(() => { });
    }, []);

    const getTeamObj = () => {
        if (!selectedTeamId) return null;
        return teams.find(t => t.value === selectedTeamId);
    };

    const getSelectedTeamName = () => {
        const t = getTeamObj();
        return t ? t.label : '';
    };

    // Helper to open edit modal
    const handleEditSession = (content, dayHeader, colIndex) => {
        const teamObj = getTeamObj();
        if (!teamObj) return;

        const { time, location } = parseScheduleContent(content);
        const dayName = dayHeader.split(' ')[0];

        const row = teamObj.absoluteRow;

        setSelectedSessionForEdit({
            team: teamObj.label,
            coach: teamObj.coach,
            day: dayName,
            time: time,
            location: location,
            raw: content,
            row: row,
            col: colIndex
        });
        setIsEditModalOpen(true);
    };

    // ---- Share via WhatsApp (logic preserved) ----
    const shareWhatsApp = () => {
        const teamName = getSelectedTeamName();
        const teamObj = getTeamObj();
        if (!teamObj) return;

        const schedule = teamObj.row;
        const basketball = sportEmoji(); // sport-aware header icon for the shared message
        const muscle = '💪';

        let message = `${basketball} *לו"ז שבועי - ${teamName}* ${basketball}\n\n`;

        headers.slice(dayStart, dayStart + 7).forEach((dayHeader, index) => {
            const parts = dayHeader.split(' ');
            const dayName = parts[0];
            const date = parts[1] || '';
            const content = schedule[dayStart + index];

            if (!content || !content.trim() || content.toLowerCase().includes('xxx')) return;

            const lines = content.split('\n');

            lines.forEach(line => {
                if (!line.trim()) return;
                const { time, location, status, isMatch } = parseScheduleContent(line);

                let dayContent = `${time} ${location}`;

                if (status === 'cancelled') dayContent = `❌ [בוטל] ${dayContent}`;
                if (status === 'changed') dayContent = `⚠️ [שינוי] ${dayContent}`;
                if (isMatch) dayContent = `🎆 *משחק ${dayContent}* 🎆`;

                message += `${dayName} ${date}: ${dayContent}\n`;
            });
        });

        const baseUrl = `${window.location.origin}${window.location.pathname}`;
        const safeTeamParam = teamName
            .replace(/%/g, '%25')
            .replace(/&/g, '%26')
            .replace(/\+/g, '%2B')
            .replace(/#/g, '%23')
            .replace(/\?/g, '%3F')
            .replace(/=/g, '%3D')
            .replace(/ /g, '%20');
        const link = `${baseUrl}?team=${safeTeamParam}`;

        message += `\nלצפייה בלו"ז המלא:\n${link}\n\nבהצלחה! ${muscle}`;

        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank');
    };

    // ---- Save to calendar (ICS) (logic preserved) ----
    const saveToCalendar = () => {
        const schedule = getTeamObj()?.row;
        if (!schedule) return;
        const teamName = getSelectedTeamName();
        const events = headers.slice(dayStart, dayStart + 7).map((dayHeader, idx) => {
            const content = schedule[dayStart + idx];
            if (!content || !content.trim() || content.includes('xxx')) return null;
            const { location, time, isMatch } = parseScheduleContent(content);
            const date = parseHeaderDate(dayHeader);
            if (!date) return null;
            const timeParts = time.split('-');
            const startT = parseTime(timeParts[0]);
            const endT = timeParts[1] ? parseTime(timeParts[1]) : { h: startT.h + 1, m: startT.m + 30 };
            const startDate = new Date(date);
            startDate.setHours(startT.h, startT.m);
            const endDate = new Date(date);
            endDate.setHours(endT.h, endT.m);
            return {
                title: `${isMatch ? `${sportEmoji()} משחק` : 'אימון'} - ${teamName}`,
                location: location,
                details: `אימון קבוצת ${teamName}`,
                start: startDate,
                end: endDate
            };
        }).filter(Boolean);

        if (events.length > 0) {
            createICSFile(events, `Luaz_${teamName.replace(/\s+/g, '_')}`);
        }
    };

    // ---- Compute the nearest upcoming session for the hero card ----
    const getNextTraining = () => {
        const teamObj = getTeamObj();
        if (!teamObj) return null;
        const schedule = teamObj.row;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const candidates = [];
        headers.slice(dayStart, dayStart + 7).forEach((dayHeader, index) => {
            const content = schedule[dayStart + index];
            if (!content || !content.trim() || content.toLowerCase().includes('xxx')) return;
            const firstLine = content.split('\n').filter(l => l.trim())[0];
            if (!firstLine) return;
            const parsed = parseScheduleContent(firstLine);
            const parts = dayHeader.split(' ');
            const date = parseHeaderDate(dayHeader);
            candidates.push({
                dayName: parts[0],
                dateText: parts[1] || '',
                date,
                ...parsed
            });
        });

        if (candidates.length === 0) return null;

        const upcoming = candidates.find(c => c.date && c.date >= today);
        const chosen = upcoming || candidates[0];
        const isToday = chosen.date && chosen.date.getTime() === today.getTime();
        return { ...chosen, isToday };
    };

    const schedule = getTeamObj() ? getTeamObj().row : null;
    const dropdownTeams = teams.filter(t => t.type !== 'W');
    const next = (viewMode === 'team') ? getNextTraining() : null;
    const teamObj = getTeamObj();
    const hasWeek = schedule && headers.slice(dayStart, dayStart + 7).some((h, i) => {
        const c = schedule[dayStart + i];
        return c && c.trim() && !c.toLowerCase().includes('xxx');
    });

    // Unregistered visitor: don't expose the club board — show a welcome/explainer
    // with a link to the product page. Parents reach their team via their invite link.
    if (isAnonymous) {
        return (
            <div className="app-container">
                <div className="welcome-gate">
                    <img src={clubLogo} alt={club.name} className="welcome-logo" />
                    <h1 className="welcome-title">{club.name}</h1>
                    <p className="welcome-lead">
                        <b>הורים / שחקנים:</b> היכנסו דרך הקישור האישי שקיבלתם מהמועדון — אחרי הרשמה
                        חד-פעמית הדף נפתח ישירות על הקבוצה שלכם (ומהאפליקציה תמיד ייפתח שם).
                    </p>
                    <Link to={`/${club.slug}/trainer`} className="welcome-cta">
                        {sportEmoji()} כניסת מאמן
                    </Link>
                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginTop: '0.8rem' }}>
                        <a className="welcome-admin" href="/sales-landing.html">מה זה Squadio?</a>
                        <Link to={`/${club.slug}/admin`} className="welcome-admin">מנהל מועדון? כניסה ⚙</Link>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            {/* ===== top bar ===== */}
            <nav className="topbar">
                <div className="brand">
                    <img src={clubLogo} alt={club.name} className="brand-logo" />
                    <div>
                        <div className="brand-name">{clubBrandName}</div>
                        <div className="brand-sub">{t('brand_sub')}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <LanguageSwitcher />
                    {!memberTeam && <Link to={`/${club.slug}/admin`} className="admin-gear" title={t('admin')}>⚙</Link>}
                </div>
            </nav>

            {floatingMsg?.enabled && floatingMsg.text && (() => {
                const msgs = floatingMsg.text.split('\n').map((m) => m.trim()).filter(Boolean);
                const loop = [...msgs, ...msgs]; // duplicate for a seamless marquee loop
                return (
                    <div className="club-ticker" dir="rtl" aria-label="הודעות מהמועדון">
                        <div className="club-ticker-track">
                            {loop.map((m, i) => (
                                <span className="club-ticker-item" key={i}>📣 {m}</span>
                            ))}
                        </div>
                    </div>
                );
            })()}

            <LeagueGamesBanner data={data} headers={headers} targetGender="M" />

            {loading ? (
                <div className="loading-container">
                    <div className="bouncing-ball"></div>
                </div>
            ) : (
                <main style={{ marginTop: '1.4rem' }}>
                    {/* ===== controls (hidden for members — they only see their team) ===== */}
                    {!memberTeam && (
                    <div className="controls">
                        <select
                            className="team-select"
                            value={selectedTeamId}
                            onChange={(e) => { setSelectedTeamId(e.target.value); setViewMode('team'); }}
                        >
                            <option value="" disabled>{t('select_team')}</option>
                            {dropdownTeams.map((team) => (
                                <option key={team.value} value={team.value}>{team.label}</option>
                            ))}
                        </select>

                        <div className="view-tabs">
                            <button className={`vtab ${viewMode === 'team' ? 'on' : ''}`} onClick={() => setViewMode('team')}>{t('tab_team')}</button>
                            <button className={`vtab ${viewMode === 'halls' ? 'on' : ''}`} onClick={() => setViewMode('halls')}>📍 {t('tab_halls')}</button>
                            <button className={`vtab ${viewMode === 'daily' ? 'on' : ''}`} onClick={() => setViewMode('daily')}>📅 {t('tab_daily')}</button>
                        </div>
                    </div>
                    )}

                    {viewMode === 'halls' ? (
                        <HallView data={data} headers={headers} teams={teams} dayStart={dayStart} defaultGender="M" />
                    ) : viewMode === 'daily' ? (
                        <DailyView data={data} headers={headers} teams={teams} dayStart={dayStart} defaultGender="M" />
                    ) : !selectedTeamId ? (
                        <div className="empty-state"><h3>{t('pick_team')}</h3></div>
                    ) : (
                        <>
                            {/* ===== HERO: next training ===== */}
                            <section className="hero">
                                <div className="hero-card">
                                    <div className="hero-label">{t('next_training')} · {teamObj?.name}</div>
                                    <div className="hero-time">{next ? (next.time || '—') : t('no_next')}</div>
                                    <div className="hero-meta">
                                        <div className="m"><b>{next ? localizeDay(next.dayName) : '—'}</b><span>{next ? (next.isToday ? t('today') : next.dateText) : ''}</span></div>
                                        <div className="m"><b>{next?.location ? localizeHall(next.location) : '—'}</b><span>{next?.isMatch ? `${sportEmoji()} ${t('match')}` : t('training')}</span></div>
                                        <div className="m"><b>{teamObj?.coach || '—'}</b><span>{t('coach')}</span></div>
                                    </div>
                                    <div className="hero-actions">
                                        <button onClick={shareWhatsApp} className="whatsapp-btn action-btn" style={{ background: '#25D366' }}>
                                            <span>{t('share_whatsapp')}</span><span>💬</span>
                                        </button>
                                        <CalendarSubscribe teamLabel={getSelectedTeamName()} />
                                        <button onClick={saveToCalendar} className="action-btn ghost" title={t('cal_save_title')}>
                                            <span>{t('cal_save')}</span><span>📅</span>
                                        </button>
                                        <button onClick={() => setIsRegisterModalOpen(true)} className="action-btn ghost">
                                            <span>{t('updates')}</span><span>🔔</span>
                                        </button>
                                    </div>
                                    <div className="hero-ball" aria-hidden="true"></div>
                                </div>

                                <div className="hero-card map-card">
                                    <div className="map-info">
                                        <div className="hero-label">📍 {t('location')}</div>
                                        <h4>{next?.location ? localizeHall(next.location) : t('venue_default')}</h4>
                                        <p>{next ? `${localizeDay(next.dayName)} ${next.isToday ? `(${t('today')})` : next.dateText} · ${next.time || ''}` : t('pick_team_location')}</p>
                                        {next?.location && <NavButton location={next.location} label={`${t('navigate')} ‹`} navWith={t('nav_with')} />}
                                    </div>
                                    <div className="map-box"><div className="map-pin"></div></div>
                                </div>
                            </section>

                            {/* ===== full weekly schedule ===== */}
                            <h2 className="section-title">{t('full_week')}</h2>
                            <div className="schedule-grid">
                                {!hasWeek && <div className="empty-state"><h3>{t('no_week')} {sportEmoji()}</h3></div>}
                                {headers.slice(dayStart, dayStart + 7).map((dayHeader, index) => {
                                    const parts = dayHeader.split(' ');
                                    const dayName = parts[0];
                                    const date = parts[1] || '';
                                    const colIndex = dayStart + index;
                                    const content = schedule[colIndex];

                                    const isOffDay = !content || content.trim() === '' || content.toLowerCase().includes('xxx');
                                    if (isOffDay) return null;

                                    const lines = content.split('\n').filter(l => l.trim().length > 0);
                                    const anyMatch = lines.some(l => l.includes('משחק') || l.includes('🏀'));
                                    const anyChanged = lines.some(l => l.includes('!') || l.includes('⚠️') || l.includes('שינוי'));
                                    const allCancelled = lines.every(l => l.match(/x|בוטל|canceled|cancelled/i));

                                    let cardClass = 'schedule-card';
                                    if (allCancelled) cardClass += ' is-cancelled';
                                    else if (anyMatch) cardClass += ' is-match';
                                    else if (anyChanged) cardClass += ' is-changed';

                                    return (
                                        <div key={index} className={cardClass}>
                                            <button
                                                className="edit-btn"
                                                title={t('coach_edit_title')}
                                                onClick={(e) => { e.stopPropagation(); handleEditSession(content, dayHeader, colIndex); }}
                                            >✏️ {t('coach')}</button>

                                            <div className="day-header">
                                                <span className="day-name">{localizeDay(dayName)}</span>
                                                <span className="day-date">{date}</span>
                                            </div>
                                            <div className="events-container">
                                                {lines.map((line, lIdx) => {
                                                    const { location, time, status, isMatch } = parseScheduleContent(line);
                                                    const isCancelled = status === 'cancelled';
                                                    const isChanged = status === 'changed';
                                                    return (
                                                        <div key={lIdx} className="event-item" style={{ textDecoration: isCancelled ? 'line-through' : 'none' }}>
                                                            {isCancelled && <span className="status-tag cancelled">❌ {t('cancelled')}</span>}
                                                            {isChanged && <span className="status-tag changed">⚠️ {t('changed')}</span>}
                                                            <div className="event-time">{time}</div>
                                                            <div className="event-location">{localizeHall(location)}</div>
                                                            {isMatch && <div className="match-badge">{sportEmoji()} {t('match')}</div>}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </main>
            )}

            <TrainerEditModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                sessionData={selectedSessionForEdit}
                sheetUrl={LIVE_SHEET_API}
                availableLocations={locations}
            />

            <RegisterUpdatesModal
                isOpen={isRegisterModalOpen}
                onClose={() => setIsRegisterModalOpen(false)}
                teamName={getSelectedTeamName()}
                sheetUrl={LIVE_SHEET_API}
            />
        </div>
    );
}

export default PublicSchedule;
