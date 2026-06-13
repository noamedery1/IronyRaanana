import { useState, useMemo } from 'react';
import { flattenScheduleData, exportToExcel } from '../utils/scheduleUtils';

const HallView = ({ data, headers, teams, dayStart, defaultGender }) => {
    const [selectedHall, setSelectedHall] = useState('all');
    const [filterGender, setFilterGender] = useState(defaultGender || 'all'); // 'all', 'M', 'W'

    const filteredTeams = useMemo(() => {
        if (filterGender === 'all') return teams;
        return teams.filter(t => (t.type || 'M') === filterGender);
    }, [teams, filterGender]);

    const flatData = useMemo(() => {
        return flattenScheduleData(filteredTeams, headers, dayStart);
    }, [filteredTeams, headers, dayStart]);

    const uniqueHalls = useMemo(() => {
        const halls = new Set();
        flatData.forEach(item => { if (item.location) halls.add(item.location.trim()); });
        return Array.from(halls).sort();
    }, [flatData]);

    const scheduleByDay = useMemo(() => {
        const byDay = {};
        for (let i = 0; i < 7; i++) {
            const header = headers[dayStart + i];
            if (header) {
                const dayName = header.split(' ')[0];
                byDay[i] = { name: dayName, fullDate: header, halls: {} };
            }
        }

        flatData.forEach(item => {
            if (selectedHall !== 'all' && item.location !== selectedHall) return;
            const dayIdx = item.dayIndex;
            if (byDay[dayIdx]) {
                const hall = item.location || 'אחר';
                if (!byDay[dayIdx].halls[hall]) byDay[dayIdx].halls[hall] = [];
                byDay[dayIdx].halls[hall].push(item);
            }
        });

        // Sort + detect time conflicts within a hall
        Object.values(byDay).forEach(day => {
            Object.keys(day.halls).forEach(hall => {
                day.halls[hall].sort((a, b) => a.time.localeCompare(b.time));
                const timeCounts = {};
                day.halls[hall].forEach(s => { if (s.time) timeCounts[s.time] = (timeCounts[s.time] || 0) + 1; });
                day.halls[hall].forEach(s => { if (s.time && timeCounts[s.time] > 1) s.hasConflict = true; });
            });
        });

        return byDay;
    }, [flatData, headers, dayStart, selectedHall]);

    const handleExport = () => {
        const dataToExport = selectedHall === 'all' ? flatData : flatData.filter(item => item.location === selectedHall);
        exportToExcel(dataToExport, selectedHall === 'all' ? 'Schedule_All_Halls.xlsx' : `Schedule_${selectedHall}.xlsx`);
    };

    return (
        <div className="rv">
            <div className="rv-head">
                <h3 className="rv-title">לו"ז אולמות מרוכז</h3>
                <div className="rv-controls">
                    <div className="seg-toggle">
                        <button className={`seg-btn ${filterGender === 'all' ? 'on' : ''}`} onClick={() => setFilterGender('all')}>הכל</button>
                        <button className={`seg-btn men ${filterGender === 'M' ? 'on' : ''}`} onClick={() => setFilterGender('M')}>גברים</button>
                        <button className={`seg-btn women ${filterGender === 'W' ? 'on' : ''}`} onClick={() => setFilterGender('W')}>נשים</button>
                    </div>
                    <select className="rv-select" value={selectedHall} onChange={(e) => setSelectedHall(e.target.value)}>
                        <option value="all">כל האולמות</option>
                        {uniqueHalls.map(hall => (<option key={hall} value={hall}>{hall}</option>))}
                    </select>
                    <button className="pill-btn accent" onClick={handleExport}>📝 ייצא לאקסל</button>
                </div>
            </div>

            <div>
                {Object.values(scheduleByDay).map((day, dIdx) => (
                    <div key={dIdx} className="rv-day">
                        <div className="rv-day-head"><span>{day.fullDate}</span></div>
                        <div className="rv-day-body">
                            {Object.keys(day.halls).length === 0 ? (
                                <div className="rv-empty">אין פעילות</div>
                            ) : (
                                <div className="hall-grid">
                                    {Object.keys(day.halls).sort().map((hall) => (
                                        <div key={hall} className="hall-box">
                                            <h4>📍 {hall}</h4>
                                            {day.halls[hall].map((session, sIdx) => {
                                                const isCancelled = session.status === 'cancelled';
                                                const isChanged = session.status === 'changed';
                                                const cls = isCancelled ? 'cancelled' : (isChanged ? 'changed' : (session.isMatch ? 'match' : ''));
                                                return (
                                                    <div key={sIdx} className={`sess ${cls}`}>
                                                        <div className="sess-main" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                                            {session.hasConflict && <span className="conflict-flag" title="התנגשות שעות!">⚠️</span>}
                                                            {session.isMatch && <span title="משחק">🏀</span>}
                                                            {isCancelled && <span>❌</span>}
                                                            <span className="sess-time">{session.time}</span>
                                                            <span className="sess-team" style={{ fontWeight: 'normal', color: 'var(--text-dim)' }}>{session.team}</span>
                                                        </div>
                                                        <div className="sess-sub">{session.coach}</div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HallView;
