import { useState } from 'react';

const WeekBuilder = ({ teams, headers, teamConfig, setTeamConfig, onTeamUpdate }) => {
    // teamConfig and setTeamConfig are now passed from props for persistence
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTeamIndex, setSelectedTeamIndex] = useState(null);
    const [newConstraint, setNewConstraint] = useState({
        type: 'FIXED', // FIXED, MATCH, ATHLETICS, OFF
        day: 0, // 0 = Sunday
        startTime: '17:00',
        endTime: '18:30',
        location: 'מטרו',
        hasConflict: false
    });

    // Default time limit settings
    const [tempSettings, setTempSettings] = useState({
        maxEndTime: '22:00' // Default max end time
    });

    // Hebrew days mapping
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

    const handleSessionCountChange = (index, delta) => {
        const newConfig = [...teamConfig];
        const newVal = (newConfig[index].sessionsPerWeek || 0) + delta;
        if (newVal >= 0 && newVal <= 7) {
            newConfig[index].sessionsPerWeek = newVal;
            setTeamConfig(newConfig);
        }
    };

    const handleTypeChange = (index) => {
        const newConfig = [...teamConfig];
        const currentType = newConfig[index].type || 'M';
        const newType = currentType === 'M' ? 'W' : 'M';
        newConfig[index].type = newType;
        setTeamConfig(newConfig);

        // Notify parent to update the raw sheet data if possible
        if (onTeamUpdate) {
            onTeamUpdate(index, { type: newType });
        }
    };

    const openSettingsModal = (index) => {
        setSelectedTeamIndex(index);
        const team = teamConfig[index];
        setTempSettings({
            maxEndTime: team.maxEndTime || '22:00'
        });
        setIsSettingsModalOpen(true);
    };

    const saveSettings = () => {
        if (selectedTeamIndex === null) return;
        const newConfig = [...teamConfig];
        newConfig[selectedTeamIndex].maxEndTime = tempSettings.maxEndTime;
        setTeamConfig(newConfig);
        setIsSettingsModalOpen(false);
    };

    const openConstraintModal = (index) => {
        setSelectedTeamIndex(index);
        setNewConstraint({
            type: 'FIXED',
            day: 0,
            startTime: '17:00',
            endTime: '18:30',
            location: 'מטרו',
            hasConflict: false
        });
        setIsModalOpen(true);
    };

    const cleanLocation = (name) => {
        if (!name) return '';
        const trimmed = name.trim();
        if (trimmed.startsWith('ב') && trimmed.length > 2) {
            if (trimmed.startsWith('ב-')) return trimmed.substring(2);
            return trimmed.substring(1);
        }
        return trimmed;
    };

    const getLocationColor = (loc) => {
        if (!loc) return '#6b7280';
        let hash = 0;
        for (let i = 0; i < loc.length; i++) {
            hash = loc.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash % 360);
        return `hsl(${hue}, 65%, 45%)`; // Distinct colors
    };

    const addConstraint = () => {
        if (selectedTeamIndex === null) return;

        let constraint = { ...newConstraint };

        // 1. Clean Hall Name
        if (constraint.location) {
            constraint.location = cleanLocation(constraint.location);
        }

        // Conflict Check logic
        let isConflict = false;
        let conflictMsg = '';

        if (constraint.type === 'FIXED' || constraint.type === 'MATCH' || constraint.type === 'ATHLETICS') {
            const getMinutes = (timeStr) => {
                const [h, m] = timeStr.split(':').map(Number);
                return h * 60 + m;
            };

            const newStart = getMinutes(constraint.startTime);
            const newEnd = getMinutes(constraint.endTime);
            const newLoc = constraint.location;

            for (let i = 0; i < teamConfig.length; i++) {
                if (i === selectedTeamIndex) continue;
                const otherTeam = teamConfig[i];
                if (!otherTeam.constraints) continue;

                for (const c of otherTeam.constraints) {
                    if (c.day !== constraint.day) continue;
                    if (c.type === 'OFF') continue;

                    const otherStart = getMinutes(c.startTime);
                    const otherEnd = getMinutes(c.endTime);

                    if (Math.max(newStart, otherStart) < Math.min(newEnd, otherEnd)) {
                        // 1. Same Coach
                        if (teamConfig[selectedTeamIndex].coach && otherTeam.coach &&
                            teamConfig[selectedTeamIndex].coach === otherTeam.coach) {
                            isConflict = true;
                            conflictMsg = `התנגשות מאמן: ${otherTeam.coach} כבר משובץ עם ${otherTeam.name}`;
                        }

                        // 2. Same Location (Hall)
                        const otherLoc = c.location ? cleanLocation(c.location) : '';

                        // "Games are orange always" - User says dont block games in same hall
                        const bothMatches = constraint.type === 'MATCH' && c.type === 'MATCH';
                        const locationsMatch = newLoc && otherLoc && newLoc === otherLoc;

                        if (locationsMatch && !bothMatches) {
                            isConflict = true;
                            conflictMsg = isConflict ? conflictMsg + " | " : "";
                            conflictMsg += `התנגשות מיקום: ${newLoc} תפוס ע"י ${otherTeam.name}`;
                        }
                    }
                }
            }
        }

        if (isConflict) {
            if (!window.confirm(`נמצאה התנגשות:\n${conflictMsg}\n\nהאם להוסיף בכל זאת?`)) {
                return;
            }
            constraint.hasConflict = true;
        } else {
            constraint.hasConflict = false;
        }

        // Create a human readable label
        let label = '';
        const dayName = days[constraint.day];

        if (constraint.type === 'OFF') {
            label = `${dayName}: יום חופש`;
        } else if (constraint.type === 'MATCH') {
            label = `${dayName} ${constraint.startTime}: משחק ${constraint.location}`;
        } else if (constraint.type === 'ATHLETICS') {
            label = `${dayName} ${constraint.startTime}-${constraint.endTime}: אתלטיקה ${constraint.location}`;
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

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.5fr) 60px 100px 150px 3fr', gap: '1rem', paddingBottom: '0.8rem', borderBottom: '2px solid #eee', fontWeight: '600', color: '#444' }}>
                <div>קבוצה</div>
                <div style={{ textAlign: 'center' }}>מגדר</div>
                <div style={{ textAlign: 'center' }}>משך (דק')</div>
                <div style={{ textAlign: 'center' }}>אימונים בשבוע</div>
                <div>אילוצים ושריון מגרשים</div>
            </div>

            <div style={{ maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
                {teamConfig.map((team, index) => (
                    <div key={index} style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(200px, 1.5fr) 60px 100px 150px 3fr',
                        gap: '1rem',
                        padding: '0.8rem 0',
                        borderBottom: '1px solid #f0f0f0',
                        alignItems: 'center',
                        backgroundColor: index % 2 === 0 ? 'white' : '#fafafa'
                    }}>
                        <div style={{ paddingRight: '0.5rem' }}>
                            <div style={{ fontWeight: '500' }}>{team.name}</div>
                            {team.coach && <div style={{ fontSize: '0.85rem', color: '#666' }}>{team.coach}</div>}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <button
                                onClick={() => handleTypeChange(index)}
                                style={{
                                    border: 'none',
                                    background: team.type === 'W' ? '#BE185D' : '#3b82f6',
                                    color: 'white',
                                    borderRadius: '50%',
                                    width: '30px',
                                    height: '30px',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                    fontWeight: 'bold'
                                }}
                                title={team.type === 'W' ? 'נשים' : 'גברים'}
                            >
                                {team.type === 'W' ? 'W' : 'M'}
                            </button>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <select
                                value={team.duration || 90}
                                onChange={(e) => {
                                    const newConfig = [...teamConfig];
                                    newConfig[index].duration = parseInt(e.target.value);
                                    setTeamConfig(newConfig);
                                }}
                                style={{ padding: '0.3rem', borderRadius: '4px', border: '1px solid #ddd' }}
                            >
                                <option value={45}>45 דק'</option>
                                <option value={60}>60 דק'</option>
                                <option value={90}>90 דק'</option>
                                <option value={120}>120 דק'</option>
                            </select>
                        </div>

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

                            <button
                                onClick={() => openSettingsModal(index)}
                                title="הגדרות שעות (מגבלת שעת סיום)"
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '1.2rem',
                                    marginLeft: '0.5rem',
                                    opacity: 0.6
                                }}
                            >⚙️</button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                            {team.constraints.map((c, cIdx) => (
                                <span key={cIdx} style={{
                                    background: c.type === 'OFF' ? '#EF476F' :
                                        c.type === 'MATCH' ? '#FCA311' :
                                            getLocationColor(c.location),
                                    color: 'white',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '12px',
                                    fontSize: '0.8rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                    border: c.hasConflict ? '2px solid red' : 'none',
                                    boxShadow: c.hasConflict ? '0 0 5px red' : 'none'
                                }}>
                                    {c.hasConflict && <span>⚠️</span>}
                                    {c.label}
                                    <span
                                        onClick={() => removeConstraint(index, cIdx)}
                                        style={{ cursor: 'pointer', fontWeight: 'bold', marginLeft: '4px' }}
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
                                    onChange={(e) => {
                                        const t = e.target.value;
                                        const update = { type: t };
                                        if (t === 'ATHLETICS') {
                                            // Default 1 hour for athletics
                                            const [h, m] = newConstraint.startTime.split(':').map(Number);
                                            const endH = h + 1;
                                            update.endTime = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                                        }
                                        setNewConstraint({ ...newConstraint, ...update });
                                    }}
                                    style={inputStyle}
                                >
                                    <option value="FIXED">אימון קבוע (שריון)</option>
                                    <option value="MATCH">משחק</option>
                                    <option value="ATHLETICS">אימון אתלטיקה</option>
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

            {/* Settings Modal */}
            {isSettingsModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', width: '350px', maxWidth: '90%' }}>
                        <h4 style={{ marginTop: 0 }}>הגדרות קבוצה - {teamConfig[selectedTeamIndex]?.name}</h4>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={labelStyle}>שעת סיום מקסימלית לאימון</label>
                            <p style={{ fontSize: '0.8rem', color: '#888', margin: '0 0 0.5rem 0' }}>המערכת האוטומטית לא תשבץ אימונים שמסתיימים אחרי שעה זו.</p>
                            <input
                                type="time"
                                value={tempSettings.maxEndTime}
                                onChange={(e) => setTempSettings({ ...tempSettings, maxEndTime: e.target.value })}
                                style={inputStyle}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                            <button onClick={() => setIsSettingsModalOpen(false)} style={{ flex: 1, padding: '0.8rem', border: '1px solid #ddd', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>ביטול</button>
                            <button onClick={saveSettings} style={{ flex: 1, padding: '0.8rem', border: 'none', background: '#3b82f6', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>שמור הגדרות</button>
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
        case 'ATHLETICS': return '#10B981';
        case 'OFF': return '#EF476F'; // Red
        default: return '#ccc';
    }
};

export default WeekBuilder;
