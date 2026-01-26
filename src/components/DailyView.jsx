import { useMemo, useState } from 'react';
import { flattenScheduleData } from '../utils/scheduleUtils';

const DailyView = ({ data, headers, teams, dayStart, defaultGender }) => {
    const [sortBy, setSortBy] = useState('hall'); // 'hall', 'time'
    const [filterGender, setFilterGender] = useState(defaultGender || 'all'); // 'all', 'M', 'W'

    // Filter teams based on gender selection first
    const filteredTeams = useMemo(() => {
        if (filterGender === 'all') return teams;
        return teams.filter(t => (t.type || 'M') === filterGender);
    }, [teams, filterGender]);

    // Flatten data
    const flatData = useMemo(() => {
        return flattenScheduleData(filteredTeams, headers, dayStart);
    }, [filteredTeams, headers, dayStart]);

    // Group by Day
    const scheduleByDay = useMemo(() => {
        const byDay = {};
        // Initialize days
        for (let i = 0; i < 7; i++) {
            const header = headers[dayStart + i];
            if (header) {
                const dayName = header.split(' ')[0];
                byDay[i] = {
                    name: dayName,
                    fullDate: header,
                    sessions: []
                };
            }
        }

        flatData.forEach(item => {
            const dayIdx = item.dayIndex;
            if (byDay[dayIdx]) {
                byDay[dayIdx].sessions.push(item);
            }
        });

        // Sort items in each day
        Object.values(byDay).forEach(day => {
            day.sessions.sort((a, b) => {
                if (sortBy === 'time') {
                    // Time then Location
                    const timeA = a.time || '';
                    const timeB = b.time || '';
                    const timeDiff = timeA.localeCompare(timeB);
                    if (timeDiff !== 0) return timeDiff;
                    return a.location.localeCompare(b.location);
                } else {
                    // Location then Time (Default)
                    const locDiff = a.location.localeCompare(b.location);
                    if (locDiff !== 0) return locDiff;
                    return (a.time || '').localeCompare(b.time || '');
                }
            });
        });

        return byDay;
    }, [flatData, headers, dayStart, sortBy]);

    return (
        <div style={{ marginTop: '2rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#1e3a8a', textAlign: 'center' }}>לו"ז יומי מרוכז - כל הקבוצות</h3>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.2rem', background: '#f3f4f6', padding: '0.2rem', borderRadius: '6px' }}>
                    <button
                        onClick={() => setFilterGender('all')}
                        style={{
                            border: 'none',
                            background: filterGender === 'all' ? '#1f2937' : 'transparent',
                            color: filterGender === 'all' ? 'white' : '#666',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        הכל
                    </button>
                    <button
                        onClick={() => setFilterGender('M')}
                        style={{
                            border: 'none',
                            background: filterGender === 'M' ? '#ea580c' : 'transparent',
                            color: filterGender === 'M' ? 'white' : '#666',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        גברים
                    </button>
                    <button
                        onClick={() => setFilterGender('W')}
                        style={{
                            border: 'none',
                            background: filterGender === 'W' ? '#be185d' : 'transparent',
                            color: filterGender === 'W' ? 'white' : '#666',
                            padding: '0.4rem 0.8rem',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        נשים
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        onClick={() => setSortBy('hall')}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '6px',
                            border: sortBy === 'hall' ? '2px solid #1e3a8a' : '1px solid #ccc',
                            background: sortBy === 'hall' ? '#eff6ff' : 'white', // ... existing styles
                            color: sortBy === 'hall' ? '#1e3a8a' : '#666',
                            fontWeight: sortBy === 'hall' ? 'bold' : 'normal',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }}
                    >
                        🏢 לפי אולם
                    </button>
                    <button
                        onClick={() => setSortBy('time')}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '6px',
                            border: sortBy === 'time' ? '2px solid #1e3a8a' : '1px solid #ccc',
                            background: sortBy === 'time' ? '#eff6ff' : 'white',
                            color: sortBy === 'time' ? '#1e3a8a' : '#666',
                            fontWeight: sortBy === 'time' ? 'bold' : 'normal',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }}
                    >
                        ⏰ לפי שעה
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {Object.values(scheduleByDay).map((day, dIdx) => (
                    <div key={dIdx} style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                        <div style={{
                            background: '#1e3a8a',
                            color: 'white',
                            padding: '0.8rem 1.2rem',
                            fontWeight: 'bold',
                            fontSize: '1.2rem',
                            display: 'flex',
                            justifyContent: 'space-between'
                        }}>
                            <span>{day.fullDate}</span>
                            <span style={{ opacity: 0.8, fontSize: '0.9rem' }}>{day.sessions.length} אירועים</span>
                        </div>

                        <div style={{ padding: '0.5rem' }}>
                            {day.sessions.length === 0 ? (
                                <div style={{ padding: '1rem', textAlign: 'center', color: '#aaa' }}>אין פעילות מתוכננת</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {day.sessions.map((session, sIdx) => (
                                        <div key={sIdx} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '0.8rem',
                                            borderBottom: sIdx < day.sessions.length - 1 ? '1px solid #f0f0f0' : 'none',
                                            background: session.isMatch ? '#fff1f2' : (sIdx % 2 === 0 ? '#fafafa' : 'white'),
                                            borderRight: session.isMatch ? '4px solid #be185d' : '4px solid transparent'
                                        }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flex: 1 }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#1f2937' }}>{session.time}</span>
                                                    {session.isMatch && <span style={{ fontSize: '0.7rem', background: '#be185d', color: 'white', padding: '2px 6px', borderRadius: '10px' }}>משחק</span>}
                                                </div>
                                                <div style={{ fontWeight: '600', color: '#374151' }}>{session.team}</div>
                                                <div style={{ fontSize: '0.85rem', color: '#6b7280', display: 'flex', gap: '5px' }}>
                                                    <span style={{ fontWeight: '800', color: '#000' }}>{session.location}</span>
                                                    {session.coach && <span> • מאמן: {session.coach}</span>}
                                                </div>
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

export default DailyView;
