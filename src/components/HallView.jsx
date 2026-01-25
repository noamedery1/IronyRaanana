import { useState, useMemo } from 'react';
import { flattenScheduleData, exportToExcel, parseCellContent } from '../utils/scheduleUtils';

const HallView = ({ data, headers, teams, dayStart }) => {
    // Flatten data
    const flatData = useMemo(() => {
        // We need to reconstruct "teams" array with rows because 'teams' prop has { row, name, coach }
        return flattenScheduleData(teams, headers, dayStart);
    }, [teams, headers, dayStart]);

    const [selectedHall, setSelectedHall] = useState('all');

    // Get unique halls
    const uniqueHalls = useMemo(() => {
        const halls = new Set();
        flatData.forEach(item => {
            if (item.location) halls.add(item.location.trim());
        });
        return Array.from(halls).sort();
    }, [flatData]);

    // Group by Day -> Hall (Filtered)
    const scheduleByDay = useMemo(() => {
        const byDay = {};
        // Initialize days
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
                if (!byDay[dayIdx].halls[hall]) {
                    byDay[dayIdx].halls[hall] = [];
                }
                byDay[dayIdx].halls[hall].push(item);
            }
        });

        // Sort items in each hall by time
        Object.values(byDay).forEach(day => {
            Object.keys(day.halls).forEach(hall => {
                day.halls[hall].sort((a, b) => a.time.localeCompare(b.time));
            });
        });

        return byDay;
    }, [flatData, headers, dayStart, selectedHall]);

    const handleExport = () => {
        const dataToExport = selectedHall === 'all'
            ? flatData
            : flatData.filter(item => item.location === selectedHall);

        exportToExcel(dataToExport, selectedHall === 'all' ? 'Schedule_All_Halls.xlsx' : `Schedule_${selectedHall}.xlsx`);
    };

    return (
        <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h3 style={{ margin: 0, color: '#831843' }}>לו"ז אולמות מרוכז</h3>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <select
                        value={selectedHall}
                        onChange={(e) => setSelectedHall(e.target.value)}
                        style={{
                            padding: '0.6rem',
                            borderRadius: '6px',
                            border: '1px solid #ccc',
                            fontSize: '0.9rem',
                            minWidth: '150px'
                        }}
                    >
                        <option value="all">כל האולמות</option>
                        {uniqueHalls.map(hall => (
                            <option key={hall} value={hall}>{hall}</option>
                        ))}
                    </select>

                    <button
                        onClick={handleExport}
                        style={{
                            background: '#10B981',
                            color: 'white',
                            border: 'none',
                            padding: '0.6rem 1.2rem',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}
                    >
                        📝 ייצא לאקסל
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {Object.values(scheduleByDay).map((day, dIdx) => (
                    <div key={dIdx} style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                        <div style={{ background: '#BE185D', color: 'white', padding: '0.8rem 1.2rem', fontWeight: 'bold', fontSize: '1.1rem' }}>
                            {day.fullDate}
                        </div>
                        <div style={{ padding: '1rem' }}>
                            {Object.keys(day.halls).length === 0 ? (
                                <div style={{ color: '#aaa', fontStyle: 'italic', textAlign: 'center' }}>אין פעילות</div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                    {Object.keys(day.halls).sort().map((hall) => (
                                        <div key={hall} style={{ border: '1px solid #f0f0f0', borderRadius: '8px', padding: '0.8rem', background: '#fffafa' }}>
                                            <h4 style={{ margin: '0 0 0.8rem 0', color: '#831843', borderBottom: '1px solid #eee', paddingBottom: '0.5rem' }}>{hall}</h4>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {day.halls[hall].map((session, sIdx) => (
                                                    <div key={sIdx} style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        fontSize: '0.9rem',
                                                        padding: '0.4rem',
                                                        background: session.isMatch ? '#fff1f2' : 'white',
                                                        borderRadius: '4px',
                                                        borderRight: session.isMatch ? '3px solid #BE185D' : '3px solid #ddd'
                                                    }}>
                                                        <div style={{ fontWeight: '600', color: '#333' }}>
                                                            {session.time}
                                                            <span style={{ fontWeight: 'normal', color: '#666', marginRight: '5px' }}>
                                                                {session.team}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: '0.8rem', color: '#888' }}>{session.coach}</div>
                                                    </div>
                                                ))}
                                            </div>
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
