import { useMemo, useState } from 'react';
import { flattenScheduleData, exportToExcel } from '../utils/scheduleUtils';

const DailyView = ({ data, headers, teams, dayStart, defaultGender }) => {
    const [sortBy, setSortBy] = useState('hall'); // 'hall', 'time'
    const [filterGender, setFilterGender] = useState(defaultGender || 'all'); // 'all', 'M', 'W'
    const [showGamesOnly, setShowGamesOnly] = useState(false);

    const filteredTeams = useMemo(() => {
        if (filterGender === 'all') return teams;
        return teams.filter(t => (t.type || 'M') === filterGender);
    }, [teams, filterGender]);

    const flatData = useMemo(() => {
        return flattenScheduleData(filteredTeams, headers, dayStart);
    }, [filteredTeams, headers, dayStart]);

    const processedData = useMemo(() => {
        if (showGamesOnly) return flatData.filter(item => item.isMatch);
        return flatData;
    }, [flatData, showGamesOnly]);

    const scheduleByDay = useMemo(() => {
        const byDay = {};
        for (let i = 0; i < 7; i++) {
            const header = headers[dayStart + i];
            if (header) {
                const dayName = header.split(' ')[0];
                byDay[i] = { name: dayName, fullDate: header, sessions: [] };
            }
        }

        processedData.forEach(item => {
            const dayIdx = item.dayIndex;
            if (byDay[dayIdx]) byDay[dayIdx].sessions.push(item);
        });

        Object.values(byDay).forEach(day => {
            day.sessions.sort((a, b) => {
                if (sortBy === 'time') {
                    const timeDiff = (a.time || '').localeCompare(b.time || '');
                    if (timeDiff !== 0) return timeDiff;
                    return a.location.localeCompare(b.location);
                } else {
                    const locDiff = a.location.localeCompare(b.location);
                    if (locDiff !== 0) return locDiff;
                    return (a.time || '').localeCompare(b.time || '');
                }
            });
        });

        return byDay;
    }, [processedData, headers, dayStart, sortBy]);

    const handleExport = () => {
        const genderLabel = filterGender === 'all' ? 'All' : (filterGender === 'M' ? 'Men' : 'Women');
        const typeLabel = showGamesOnly ? 'GamesOnly' : 'Full';
        exportToExcel(processedData, `DailySchedule_${genderLabel}_${typeLabel}.xlsx`);
    };

    return (
        <div className="rv">
            <div className="rv-head">
                <h3 className="rv-title">לו"ז יומי מרוכז · כל הקבוצות</h3>
                <div className="rv-controls">
                    <div className="seg-toggle">
                        <button className={`seg-btn ${filterGender === 'all' ? 'on' : ''}`} onClick={() => setFilterGender('all')}>הכל</button>
                        <button className={`seg-btn men ${filterGender === 'M' ? 'on' : ''}`} onClick={() => setFilterGender('M')}>גברים</button>
                        <button className={`seg-btn women ${filterGender === 'W' ? 'on' : ''}`} onClick={() => setFilterGender('W')}>נשים</button>
                    </div>
                    <button className={`pill-btn ${sortBy === 'hall' ? 'on' : ''}`} onClick={() => setSortBy('hall')}>🏢 לפי אולם</button>
                    <button className={`pill-btn ${sortBy === 'time' ? 'on' : ''}`} onClick={() => setSortBy('time')}>⏰ לפי שעה</button>
                    <button className={`pill-btn ${showGamesOnly ? 'on' : ''}`} onClick={() => setShowGamesOnly(!showGamesOnly)}>🏀 רק משחקים</button>
                    <button className="pill-btn accent" onClick={handleExport}>📊 ייצוא לאקסל</button>
                </div>
            </div>

            <div>
                {Object.values(scheduleByDay).map((day, dIdx) => (
                    <div key={dIdx} className="rv-day">
                        <div className="rv-day-head">
                            <span>{day.fullDate}</span>
                            <span className="count">{day.sessions.length} אירועים</span>
                        </div>
                        <div className="rv-day-body">
                            {day.sessions.length === 0 ? (
                                <div className="rv-empty">אין פעילות מתוכננת</div>
                            ) : (
                                day.sessions.map((session, sIdx) => {
                                    const isCancelled = session.status === 'cancelled';
                                    const isChanged = session.status === 'changed';
                                    const cls = isCancelled ? 'cancelled' : (isChanged ? 'changed' : (session.isMatch ? 'match' : ''));
                                    return (
                                        <div key={sIdx} className={`sess ${cls}`}>
                                            <div className="sess-main" style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    {isCancelled && <span>❌</span>}
                                                    <span className="sess-time">{session.time}</span>
                                                    {session.isMatch && <span className="match-badge">🏀 משחק</span>}
                                                </div>
                                                <div className="sess-team">{session.team}</div>
                                                <div className="sess-sub">
                                                    <span className="sess-hall">{session.location}</span>
                                                    {session.coach && <span> · מאמן: {session.coach}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DailyView;
