import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { Link } from 'react-router-dom';
import '../App.css';
import { parseHeaderDate, parseTime, createICSFile, parseCellContent } from '../utils/scheduleUtils';
import LeagueGamesBanner from '../components/LeagueGamesBanner';
import HallView from '../components/HallView';
import DailyView from '../components/DailyView';
import RegisterUpdatesModal from '../components/RegisterUpdatesModal';
import NavButton from '../components/NavButton';
import CalendarSubscribe from '../components/CalendarSubscribe';
import { useI18n, LanguageSwitcher } from '../i18n.jsx';
import { getActiveClub } from '../clubConfig.js';

const parseScheduleContent = parseCellContent;

function PublicScheduleWomen() {
    // Data sources come from the active club (resolved from the URL path).
    const club = getActiveClub();
    const LIVE_SHEET_API = club.sheetApi;
    const DATA_URL = club.dataUrl;

    const [data, setData] = useState([]);
    const [teams, setTeams] = useState([]);
    const [headers, setHeaders] = useState([]);
    const [dayStart, setDayStart] = useState(1);
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [viewMode, setViewMode] = useState('team');
    const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
    const { t, localizeDay, localizeHall } = useI18n();

    useEffect(() => {
        const fetchData = async () => {
            if (!DATA_URL) {
                setError('טרם הוגדר קישור לגיליון.');
                setLoading(false);
                return;
            }

            try {
                const csvUrl = DATA_URL;
                const response = await fetch(csvUrl);
                if (!response.ok) throw new Error('Network response was not ok');

                const reader = response.body.getReader();
                const result = await reader.read();
                const decoder = new TextDecoder('utf-8');
                const csv = decoder.decode(result.value);

                Papa.parse(csv, {
                    header: false,
                    complete: (results) => {
                        const rows = results.data;
                        let headerRowIndex = -1;

                        for (let i = 0; i < rows.length; i++) {
                            if (rows[i][0] && rows[i][0].includes('קבוצות')) {
                                headerRowIndex = i;
                                break;
                            }
                        }

                        if (headerRowIndex !== -1) {
                            const headerRow = rows[headerRowIndex];
                            const dataRows = rows.slice(headerRowIndex + 1);

                            const teamIndex = 0;
                            let coachIndex = headerRow.findIndex(h => h && (h.includes('מאמן') || h.toLowerCase().includes('coach') || h.toLowerCase().includes('trainer')));
                            let typeIndex = headerRow.findIndex(h => h && (h.toLowerCase() === 'type' || h.includes('סוג')));
                            let dayStartIndex = headerRow.findIndex(h => h && h.includes('ראשון'));

                            if (dayStartIndex === -1) {
                                dayStartIndex = (coachIndex !== -1) ? coachIndex + 1 : 1;
                            }
                            setDayStart(dayStartIndex);

                            const teamObjects = [];

                            dataRows.forEach((row, rowIndex) => {
                                const name = row[teamIndex];
                                if (!name || name.trim() === '') return;

                                if (['באנר', 'banner'].some(b => name.trim().toLowerCase().includes(b))) return;

                                const typeVal = (typeIndex !== -1 && row[typeIndex]) ? row[typeIndex].trim().toUpperCase() : 'M';

                                const coach = (coachIndex !== -1) ? row[coachIndex] : '';
                                const label = coach ? `${name} - ${coach}` : name;

                                teamObjects.push({
                                    label: label,
                                    value: rowIndex.toString(),
                                    name: name.trim(),
                                    coach: coach ? coach.trim() : '',
                                    type: typeVal,
                                    row: row
                                });
                            });

                            setHeaders(headerRow);
                            setTeams(teamObjects);
                            setData(dataRows);

                            const womenTeams = teamObjects.filter(t => t.type === 'W');

                            const urlParams = new URLSearchParams(window.location.search);
                            const sharedTeam = urlParams.get('team');
                            let defaultTeamId = '';

                            if (sharedTeam) {
                                const found = teamObjects.find(t => t.label === sharedTeam || t.name === sharedTeam);
                                if (found) defaultTeamId = found.value;
                            }

                            if (!defaultTeamId && womenTeams.length > 0) {
                                defaultTeamId = womenTeams[0].value;
                            }

                            setSelectedTeamId(defaultTeamId);
                        } else {
                            setError('לא נמצאה שורת כותרת ("קבוצות") בגיליון.');
                        }
                        setLoading(false);
                    },
                    error: (error) => {
                        console.error('Error parsing CSV:', error);
                        setError('שגיאה בפענוח הנתונים.');
                        setLoading(false);
                    }
                });
            } catch (error) {
                console.error('Error fetching data:', error);
                setError('שגיאה בטעינת הנתונים. וודא שהגיליון ציבורי.');
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const getTeamObj = () => {
        if (!selectedTeamId) return null;
        return teams.find(t => t.value === selectedTeamId);
    };

    const getSelectedTeamName = () => {
        const t = getTeamObj();
        return t ? t.label : '';
    };

    const shareViaWhatsApp = () => {
        const teamObj = getTeamObj();
        if (!teamObj) return;
        const schedule = teamObj.row;
        const teamLabel = getSelectedTeamName();
        const basketball = '🏀';
        const muscle = '💪';

        let message = `${basketball} *לו"ז שבועי - ${teamLabel} (נשים)* ${basketball}\n\n`;

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
        const safeTeamParam = teamLabel
            .replace(/%/g, '%25').replace(/&/g, '%26').replace(/\+/g, '%2B')
            .replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/=/g, '%3D').replace(/ /g, '%20');
        const link = `${baseUrl}?team=${safeTeamParam}`;
        message += `\nלצפייה בלו"ז המלא:\n${link}\n\nבהצלחה! ${muscle}`;

        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank');
    };

    const saveToCalendar = () => {
        const teamObj = getTeamObj();
        if (!teamObj) return;
        const schedule = teamObj.row;
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
                title: `${isMatch ? '🏀 משחק' : 'אימון'} - ${teamName}`,
                location: location,
                details: `אימון קבוצת ${teamName}`,
                start: startDate,
                end: endDate
            };
        }).filter(Boolean);

        if (events.length > 0) {
            createICSFile(events, `Luaz_${teamName.replace(/\s+/g, '_')}`);
        } else {
            alert('לא נמצאו אימון לייצוא השבוע.');
        }
    };

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
            candidates.push({ dayName: parts[0], dateText: parts[1] || '', date, ...parsed });
        });

        if (candidates.length === 0) return null;
        const upcoming = candidates.find(c => c.date && c.date >= today);
        const chosen = upcoming || candidates[0];
        const isToday = chosen.date && chosen.date.getTime() === today.getTime();
        return { ...chosen, isToday };
    };

    const schedule = getTeamObj() ? getTeamObj().row : null;
    const dropdownTeams = teams.filter(t => t.type === 'W');
    const next = (viewMode === 'team') ? getNextTraining() : null;
    const teamObj = getTeamObj();
    const hasWeek = schedule && headers.slice(dayStart, dayStart + 7).some((h, i) => {
        const c = schedule[dayStart + i];
        return c && c.trim() && !c.toLowerCase().includes('xxx');
    });

    return (
        <div className="app-container theme-women">
            {/* ===== top bar ===== */}
            <nav className="topbar">
                <div className="brand">
                    <img src="/women_logo.png" alt="מכבי רעננה" className="brand-logo" />
                    <div>
                        <div className="brand-name">מכבי רעננה · נשים</div>
                        <div className="brand-sub">{t('brand_sub')}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div className="gender-switch">
                        <Link to="/" className="gender-btn men">{t('men')} 👨</Link>
                        <Link to="/women" className="gender-btn women on">{t('women')} 👩</Link>
                    </div>
                    <LanguageSwitcher />
                    <Link to="/admin" className="admin-gear" title={t('admin')}>⚙</Link>
                </div>
            </nav>

            <LeagueGamesBanner data={data} headers={headers} targetGender="W" />

            {loading ? (
                <div className="loading-container">
                    <div className="bouncing-ball"></div>
                </div>
            ) : error ? (
                <div className="empty-state" style={{ marginTop: '2rem' }}><h3>{error}</h3></div>
            ) : (
                <main style={{ marginTop: '1.4rem' }}>
                    {/* ===== controls ===== */}
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

                    {viewMode === 'halls' ? (
                        <HallView data={data} headers={headers} teams={teams} dayStart={dayStart} defaultGender="W" />
                    ) : viewMode === 'daily' ? (
                        <DailyView data={data} headers={headers} teams={teams} dayStart={dayStart} defaultGender="W" />
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
                                        <div className="m"><b>{next?.location ? localizeHall(next.location) : '—'}</b><span>{next?.isMatch ? `🏀 ${t('match')}` : t('training')}</span></div>
                                        <div className="m"><b>{teamObj?.coach || '—'}</b><span>{t('coach')}</span></div>
                                    </div>
                                    <div className="hero-actions">
                                        <button onClick={shareViaWhatsApp} className="whatsapp-btn action-btn" style={{ background: '#25D366' }}>
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
                                {!hasWeek && <div className="empty-state"><h3>{t('no_week')} 🏀</h3></div>}
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
                                                            {isMatch && <div className="match-badge">🏀 {t('match')}</div>}
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

            <RegisterUpdatesModal
                isOpen={isRegisterModalOpen}
                onClose={() => setIsRegisterModalOpen(false)}
                teamName={getSelectedTeamName()}
                sheetUrl={LIVE_SHEET_API}
            />
        </div>
    );
}

export default PublicScheduleWomen;
