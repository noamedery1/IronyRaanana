import { useState, useEffect } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { sortTeams, SORT_MODES } from '../teamSort.js';
import { venues } from '../sportLabels.js';
import { encodePathSeg } from '../encodeSeg.js';
import { authHeaders } from '../adminApi.js';

// Manager tool: generate invite links per team (members) + an operator link.
// Members open their link once, register, and are then locked to that team's view.
// Each team also has a short 5-digit CODE a parent can type instead of the link (simpler on phones).
export default function InviteLinks() {
    const [teams, setTeams] = useState([]); // full team objects from the DB (name/gender/age/grade)
    const [codes, setCodes] = useState({}); // team name -> 5-digit join code
    const [teamSort, setTeamSort] = useState('name');
    const [copied, setCopied] = useState('');

    const club = getActiveClub();
    // For a club with its own subdomain, build invite links on that origin
    // (fcraanana.squadio.techbynoam.com/…) so recipients land straight on the isolated per-club app.
    // Falls back to the current origin for clubs still served on the apex. (Old apex links keep
    // working too — the server 302-forwards them to the subdomain.)
    const base = `${club.inviteOrigin || window.location.origin}/${club.slug}`;
    // Path-based invite links (role/team in the PATH, not a query) so the installed PWA icon keeps the
    // context on iOS, which strips the query from a home-screen app's start_url.
    const operatorLink = `${base}/join/operator`;
    const trainerLink = `${base}/trainer`;

    useEffect(() => {
        // Read the DB teams (works for a brand-new club before any schedule is published).
        fetch(`/api/${club.slug}/teams`).then((r) => r.json())
            .then((d) => { if (Array.isArray(d.teams)) setTeams(d.teams); })
            .catch(() => { /* server down in dev */ });
        // Each team's 5-digit join code (manager-only endpoint).
        fetch(`/api/${club.slug}/teams/join-codes`, { headers: authHeaders(club.slug) }).then((r) => r.json())
            .then((d) => {
                if (Array.isArray(d.teams)) {
                    const m = {};
                    d.teams.forEach((t) => { if (t.code) m[t.team] = t.code; });
                    setCodes(m);
                }
            })
            .catch(() => { /* non-fatal */ });
    }, [club.slug]);

    const teamLink = (name) => `${base}/join/member/${encodePathSeg(name)}`;

    const copy = (text, key) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(key);
            setTimeout(() => setCopied(''), 1500);
        });
    };

    const row = (label, link, key) => (
        <div key={key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 130, fontWeight: 600, color: '#0f1b33' }}>{label}</div>
            <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 180, padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1', direction: 'ltr', fontSize: '0.8rem', color: '#334155' }} />
            <button onClick={() => copy(link, key)} style={{ background: '#ff7a18', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5rem 0.9rem', fontWeight: 'bold', cursor: 'pointer' }}>
                {copied === key ? '✓ הועתק' : 'העתק'}
            </button>
        </div>
    );

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>🔗 לינקי הזמנה</h3>
            <p style={{ color: '#666', marginTop: 0 }}>שלחו את הלינק המתאים. מי שנכנס נרשם פעם אחת, ומשם רואה רק את החלק שלו ומקבל עדכונים רלוונטיים.</p>

            <h4 style={{ marginBottom: '0.6rem', color: '#9a3412' }}>מפעיל (לוח מלא — כל הקבוצות וה{venues()})</h4>
            {row('מפעיל', operatorLink, 'operator')}

            <h4 style={{ margin: '1.4rem 0 0.3rem', color: '#166534' }}>מאמנים</h4>
            <p style={{ margin: '0 0 0.6rem', color: '#666', fontSize: '0.85rem' }}>לינק אחד לכל המאמנים. כל מאמן מתחבר עם השם והקוד שהוגדרו לו בגיליון <b>Trainers</b>.</p>
            {row('מאמנים', trainerLink, 'trainer')}

            <div style={{ margin: '1.4rem 0 0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, color: '#1e3a8a' }}>חברי קבוצה (הורים / מתאמנים)</h4>
                <label style={{ color: '#64748b', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    מיון:
                    <select value={teamSort} onChange={(e) => setTeamSort(e.target.value)} style={{ padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                        {SORT_MODES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                </label>
            </div>
            <p style={{ margin: '0 0 0.6rem', color: '#666', fontSize: '0.85rem' }}>
                💡 <b>הכי פשוט להורים:</b> תנו להם את <b>הקוד</b> (5 ספרות) — באפליקציה הם לוחצים "יש לי קוד הצטרפות" ומקלידים אותו. הלינק הוא חלופה.
            </p>
            {teams.length === 0 && <div style={{ color: '#94a3b8' }}>אין קבוצות עדיין — הקימו קבוצות ב"👥 ניהול קבוצות".</div>}
            {sortTeams(teams, teamSort).map((t) => (
                <div key={t.name} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 130, fontWeight: 600, color: '#0f1b33', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {t.name}
                        <span style={{ background: t.gender === 'W' ? '#fce7f3' : '#dbeafe', color: t.gender === 'W' ? '#9d174d' : '#1e40af', fontSize: '0.66rem', borderRadius: 8, padding: '0.02rem 0.4rem' }}>{t.gender === 'W' ? 'בנות' : 'בנים'}</span>
                        {t.age ? <span style={{ background: '#e0e7ff', color: '#3730a3', fontSize: '0.66rem', borderRadius: 8, padding: '0.02rem 0.4rem' }}>גיל {t.age}</span> : null}
                        {t.grade ? <span style={{ background: '#dcfce7', color: '#166534', fontSize: '0.66rem', borderRadius: 8, padding: '0.02rem 0.4rem' }}>כיתה {t.grade}</span> : null}
                    </div>
                    {/* The 5-digit code — the simple option to hand a parent (they type it in the app). */}
                    {codes[t.name] && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.05rem', letterSpacing: '0.12rem', color: '#0d9488', background: '#ecfdf5', border: '1px solid #99f6e4', borderRadius: 8, padding: '0.25rem 0.6rem' }}>{codes[t.name]}</span>
                            <button onClick={() => copy(codes[t.name], 'code:' + t.name)} style={{ background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5rem 0.8rem', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>
                                {copied === 'code:' + t.name ? '✓' : 'קוד'}
                            </button>
                        </div>
                    )}
                    <input readOnly value={teamLink(t.name)} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 180, padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1', direction: 'ltr', fontSize: '0.8rem', color: '#334155' }} />
                    <button onClick={() => copy(teamLink(t.name), t.name)} style={{ background: '#ff7a18', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5rem 0.9rem', fontWeight: 'bold', cursor: 'pointer' }}>
                        {copied === t.name ? '✓ הועתק' : 'העתק'}
                    </button>
                </div>
            ))}
        </div>
    );
}
