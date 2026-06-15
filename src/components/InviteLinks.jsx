import { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { getActiveClub } from '../clubConfig.js';

// Manager tool: generate invite links per team (members) + an operator link.
// Members open their link once, register, and are then locked to that team's view.
export default function InviteLinks() {
    const [teams, setTeams] = useState([]);
    const [copied, setCopied] = useState('');

    const club = getActiveClub();
    const base = `${window.location.origin}/${club.slug}`;
    const operatorLink = `${base}/join?r=operator`;
    const trainerLink = `${base}/trainer`;

    useEffect(() => {
        Papa.parse(club.dataUrl, {
            download: true,
            complete: (res) => {
                const rows = res.data;
                let h = -1;
                for (let i = 0; i < rows.length; i++) {
                    if (rows[i][0] && rows[i][0].includes('קבוצות')) { h = i; break; }
                }
                if (h === -1) return;
                const set = new Set();
                rows.slice(h + 1).forEach((r) => {
                    const name = (r[0] || '').toString().trim();
                    if (name && !name.toLowerCase().includes('xxx')) set.add(name);
                });
                setTeams([...set]);
            },
        });
    }, [club.dataUrl]);

    const teamLink = (name) => `${base}/join?r=member&team=${encodeURIComponent(name)}`;

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

            <h4 style={{ marginBottom: '0.6rem', color: '#9a3412' }}>מפעיל (לוח מלא — כל הקבוצות והאולמות)</h4>
            {row('מפעיל', operatorLink, 'operator')}

            <h4 style={{ margin: '1.4rem 0 0.3rem', color: '#166534' }}>מאמנים</h4>
            <p style={{ margin: '0 0 0.6rem', color: '#666', fontSize: '0.85rem' }}>לינק אחד לכל המאמנים. כל מאמן מתחבר עם השם והקוד שהוגדרו לו בגיליון <b>Trainers</b>.</p>
            {row('מאמנים', trainerLink, 'trainer')}

            <h4 style={{ margin: '1.4rem 0 0.6rem', color: '#1e3a8a' }}>חברי קבוצה (הורים / מתאמנים)</h4>
            {teams.length === 0 && <div style={{ color: '#94a3b8' }}>טוען קבוצות...</div>}
            {teams.map((name) => row(name, teamLink(name), name))}
        </div>
    );
}
