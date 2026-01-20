import { useState } from 'react';

const WeekBuilder = ({ teams, headers, teamConfig, setTeamConfig }) => {
    // teamConfig and setTeamConfig are now passed from props for persistence
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTeamIndex, setSelectedTeamIndex] = useState(null);
    const [newConstraint, setNewConstraint] = useState({
        type: 'FIXED', // FIXED, MATCH, OFF
        day: 0, // 0 = Sunday
        startTime: '17:00',
        endTime: '18:30',
        location: 'מטרו'
    });

    // Hebrew days mapping
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

    const handleSessionCountChange = (index, delta) => {
        const newConfig = [...teamConfig];
        const newVal = (newConfig[index].sessionsPerWeek || 0) + delta;
        if (newVal >= 0 && newVal <= 10) {
            newConfig[index].sessionsPerWeek = newVal;
            setTeamConfig(newConfig);
        }
    };

    const openConstraintModal = (index) => {
        setSelectedTeamIndex(index);
        setNewConstraint({
            type: 'FIXED',
            day: 0,
            startTime: '17:00',
            endTime: '18:30',
            location: 'מטרו'
        });
        setIsModalOpen(true);
    };

    const addConstraint = () => {
        if (selectedTeamIndex === null) return;

        const constraint = { ...newConstraint };

        // Conflict Check
        if (constraint.type === 'FIXED') {
            const getMinutes = (timeStr) => {
                const [h, m] = timeStr.split(':').map(Number);
                return h * 60 + m;
            };

            const newStart = getMinutes(constraint.startTime);
            const newEnd = getMinutes(constraint.endTime);

            // Iterate all teams to find conflicts
            for (let i = 0; i < teamConfig.length; i++) {
                if (i === selectedTeamIndex) continue; // Skip current team ("another team")

                const otherTeam = teamConfig[i];
                if (!otherTeam.constraints) continue;

                for (const c of otherTeam.constraints) {
                    // Check only FIXED events for now as they have clear start/end times
                    // Also check if location matches
                    if (c.type === 'FIXED' && c.day === constraint.day && c.location === constraint.location) {
                        const otherStart = getMinutes(c.startTime);
                        const otherEnd = getMinutes(c.endTime);

                        // Check overlap: max(start1, start2) < min(end1, end2)
                        if (Math.max(newStart, otherStart) < Math.min(newEnd, otherEnd)) {
                            alert(`שים לב! התנגשות בשיבוץ:\nקבוצת ${otherTeam.name} כבר משובצת ב-${c.location} בשעות ${c.startTime}-${c.endTime}`);
                            // We alert but do not block, or should we block?
                            // User said "make sure and alert". Usually implies stopping or just warning. 
                            // I'll alert. If I want to block, I'd return here. 
                            // "make sure" sounds like I should prevent it? I'll prevent it for safety.
                            return;
                        }
                    }
                }
            }
        }

        // Create a human readable label
        let label = '';
        const dayName = days[constraint.day];

        if (constraint.type === 'OFF') {
            label = `${dayName}: יום חופש`;
        } else if (constraint.type === 'MATCH') {
            label = `${dayName} ${constraint.startTime}: משחק ב${constraint.location}`;
        } else {
            label = `${dayName} ${constraint.startTime}-${constraint.endTime}: ${constraint.location}`;
        }

        const newConfig = [...teamConfig];
        newConfig[selectedTeamIndex].constraints.push({ ...constraint, label });
        setTeamConfig(newConfig);
        setIsModalOpen(false);
    };

    const removeConstraint = (teamIndex, constraintIndex) => {
        const newConfig = [...teamConfig];
        newConfig[teamIndex].constraints.splice(constraintIndex, 1);
        setTeamConfig(newConfig);
    };

    if (!teams || teams.length === 0) {
        return (
            <div style={{ textAlign: 'center', color: '#666', marginTop: '2rem' }}>
                <p>לא נטענו קבוצות. אנא התחבר לגיליון בלשונית ההגדרות.</p>
            </div>
        );
    }

    return (
        <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginTop: 0, marginBottom: '1.5rem' }}>הגדרות שבועיות לאימון</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.5fr) 150px 3fr', gap: '1rem', paddingBottom: '0.8rem', borderBottom: '2px solid #eee', fontWeight: '600', color: '#444' }}>
                <div>קבוצה</div>
                <div style={{ textAlign: 'center' }}>אימונים בשבוע</div>
                <div>אילוצים ושריון מגרשים</div>
            </div>

            <div style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
                {teamConfig.map((team, index) => (
                    <div key={index} style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(200px, 1.5fr) 150px 3fr',
                        gap: '1rem',
                        padding: '0.8rem 0',
                        borderBottom: '1px solid #f0f0f0',
                        alignItems: 'center',
                        backgroundColor: index % 2 === 0 ? 'white' : '#fafafa'
                    }}>
                        <div style={{ fontWeight: '500', paddingRight: '0.5rem' }}>{team.name}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                            <button
                                onClick={() => handleSessionCountChange(index, -1)}
                                style={circleBtnStyle}
                            >-</button>
                            <span style={{ width: '20px', textAlign: 'center', fontWeight: 'bold' }}>{team.sessionsPerWeek}</span>
                            <button
                                onClick={() => handleSessionCountChange(index, 1)}
                                style={circleBtnStyle}
                            >+</button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                            {team.constraints.map((c, cIdx) => (
                                <span key={cIdx} style={{
                                    background: getTypeColor(c.type),
                                    color: 'white',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '12px',
                                    fontSize: '0.8rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                }}>
                                    {c.label}
                                    <span
                                        onClick={() => removeConstraint(index, cIdx)}
                                        style={{ cursor: 'pointer', fontWeight: 'bold' }}
                                    >×</span>
                                </span>
                            ))}
                            <button
                                onClick={() => openConstraintModal(index)}
                                style={{
                                    background: 'none',
                                    border: '1px dashed #ccc',
                                    color: '#666',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '12px',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.2rem'
                                }}>
                                + הוסף אילוץ
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '400px', maxWidth: '90%' }}>
                        <h4 style={{ marginTop: 0 }}>הוספת אילוץ - {teamConfig[selectedTeamIndex]?.name}</h4>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={labelStyle}>סוג האילוץ</label>
                                <select
                                    value={newConstraint.type}
                                    onChange={(e) => setNewConstraint({ ...newConstraint, type: e.target.value })}
                                    style={inputStyle}
                                >
                                    <option value="FIXED">אימון קבוע (שריון)</option>
                                    <option value="MATCH">משחק</option>
                                    <option value="OFF">יום חופש</option>
                                </select>
                            </div>

                            <div>
                                <label style={labelStyle}>יום בשבוע</label>
                                <select
                                    value={newConstraint.day}
                                    onChange={(e) => setNewConstraint({ ...newConstraint, day: parseInt(e.target.value) })}
                                    style={inputStyle}
                                >
                                    {days.map((d, i) => <option key={i} value={i}>{d}</option>)}
                                </select>
                            </div>

                            {newConstraint.type !== 'OFF' && (
                                <>
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={labelStyle}>התחלה</label>
                                            <input
                                                type="time"
                                                value={newConstraint.startTime}
                                                onChange={(e) => setNewConstraint({ ...newConstraint, startTime: e.target.value })}
                                                style={inputStyle}
                                            />
                                        </div>
                                        {newConstraint.type !== 'MATCH' && (
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>סיום</label>
                                                <input
                                                    type="time"
                                                    value={newConstraint.endTime}
                                                    onChange={(e) => setNewConstraint({ ...newConstraint, endTime: e.target.value })}
                                                    style={inputStyle}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label style={labelStyle}>מיקום (אולם/מגרש)</label>
                                        <input
                                            type="text"
                                            value={newConstraint.location}
                                            onChange={(e) => setNewConstraint({ ...newConstraint, location: e.target.value })}
                                            style={inputStyle}
                                        />
                                    </div>
                                </>
                            )}

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                <button onClick={() => setIsModalOpen(false)} style={{ flex: 1, padding: '0.8rem', border: '1px solid #ddd', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>ביטול</button>
                                <button onClick={addConstraint} style={{ flex: 1, padding: '0.8rem', border: 'none', background: '#3b82f6', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>שמור</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const circleBtnStyle = {
    width: '24px', height: '24px', borderRadius: '50%', border: '1px solid #ccc', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0
};

const labelStyle = { display: 'block', fontSize: '0.9rem', color: '#666', marginBottom: '0.3rem' };
const inputStyle = { width: '100%', padding: '0.6rem', borderRadius: '4px', border: '1px solid #ddd', boxSizing: 'border-box' };

const getTypeColor = (type) => {
    switch (type) {
        case 'FIXED': return '#3b82f6'; // Blue
        case 'MATCH': return '#FCA311'; // Orange
        case 'OFF': return '#EF476F'; // Red
        default: return '#ccc';
    }
};

export default WeekBuilder;
