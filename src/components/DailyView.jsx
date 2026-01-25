import { useMemo } from 'react';
import { flattenScheduleData } from '../utils/scheduleUtils';

const DailyView = ({ data, headers, teams, dayStart }) => {
    // Flatten data
    const flatData = useMemo(() => {
        return flattenScheduleData(teams, headers, dayStart);
    }, [teams, headers, dayStart]);

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

        // Sort items in each day by Location then Time
        Object.values(byDay).forEach(day => {
            day.sessions.sort((a, b) => {
                const locDiff = a.location.localeCompare(b.location);
                if (locDiff !== 0) return locDiff;
                return a.time.localeCompare(b.time);
            });
        });

        return byDay;
    }, [flatData, headers, dayStart]);

    return (
        <div style={{ marginTop: '2rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: '#1e3a8a', textAlign: 'center' }}>לו"ז יומי מרוכז - כל הקבוצות</h3>

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
