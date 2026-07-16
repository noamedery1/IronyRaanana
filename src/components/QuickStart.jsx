import { useEffect, useState } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';
import { venues } from '../sportLabels.js';

// First-run onboarding checklist for a new club. Reads live counts and lights up each
// step as it's completed, with a button that jumps to the matching tab.
export default function QuickStart({ go }) {
    const club = getActiveClub();
    const slug = club.slug;
    const [s, setS] = useState({ teams: 0, fields: 0, trainers: 0, draft: 0, published: false });

    useEffect(() => {
        let alive = true;
        Promise.all([
            fetch(`/api/${slug}/teams`).then((r) => r.json()).catch(() => ({})),
            fetch(`/api/${slug}/halls`).then((r) => r.json()).catch(() => ({})),
            fetch(`/api/${slug}/trainers`).then((r) => r.json()).catch(() => ({})),
            fetch(`/api/${slug}/draft`, { headers: authHeaders(slug) }).then((r) => r.json()).catch(() => ({})),
            fetch(`/api/${slug}/publications`).then((r) => r.json()).catch(() => ({})),
        ]).then(([teams, halls, trainers, draft, pubs]) => {
            if (!alive) return;
            setS({
                teams: (teams.teams || []).length,
                fields: (halls.halls || []).length,
                trainers: (trainers.trainers || []).length,
                draft: (draft.sessions || []).length,
                published: Array.isArray(pubs.publications) ? pubs.publications.length > 0 : !!pubs.publication,
            });
        });
        return () => { alive = false; };
    }, [slug]);

    const steps = [
        { key: 'teams', done: s.teams > 0, tab: 'teamsAdmin', icon: '👥', title: 'הקמת קבוצות', desc: 'הוסף את קבוצות המועדון (שם + בנים/בנות). שם מאמן אינו חובה — משייכים מאמנים בשלב 3.', count: s.teams && `${s.teams} קבוצות` },
        { key: 'fields', done: s.fields > 0, tab: 'halls', icon: '🏟️', title: `הקמת ${venues()}`, desc: `הגדר את ה${venues()} של המועדון וכתובת לניווט.`, count: s.fields && `${s.fields}` },
        { key: 'trainers', done: s.trainers > 0, tab: 'trainersAdmin', icon: '👤', title: 'הקמת מאמנים', desc: 'צור חשבונות מאמנים (עם קוד כניסה) ושייך כל מאמן לקבוצות שלו — הן כבר קיימות משלב 1.', count: s.trainers && `${s.trainers} מאמנים` },
        { key: 'build', done: s.draft > 0, tab: 'preview', icon: '📅', title: 'בניית לו"ז', desc: 'שבץ אימונים בלוח — התחל מלו"ז ריק, בלי אקסל.', count: s.draft && `${s.draft} אימונים` },
        { key: 'publish', done: s.published, tab: 'publish', icon: '🚀', title: 'פרסום הלו"ז', desc: 'פרסם את הלו"ז כדי שההורים יראו אותו.', count: s.published && 'פורסם' },
        { key: 'links', done: false, tab: 'invites', icon: '🔗', title: 'שליחת לינקים', desc: 'צור לינקי הזמנה להורים, שחקנים ומאמנים.', count: '' },
    ];
    const completed = steps.filter((x) => x.done && x.key !== 'links').length;

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0, marginBottom: '0.2rem' }}>🚀 התחלה מהירה — {club.name}</h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: 0 }}>
                ברוך הבא! עקוב אחרי השלבים כדי להעלות את המועדון לאוויר. אין צורך לטעון קובץ אקסל — אפשר להתחיל מלו"ז ריק.
                <b style={{ marginInlineStart: '0.5rem' }}>({completed}/5 הושלמו)</b>
            </p>
            <div style={{ display: 'grid', gap: '0.6rem', marginTop: '1rem' }}>
                {steps.map((step, i) => (
                    <div key={step.key} style={{
                        display: 'flex', alignItems: 'center', gap: '0.9rem',
                        background: step.done ? '#f0fdf4' : '#f8fafc',
                        border: `1px solid ${step.done ? '#86efac' : '#e2e8f0'}`,
                        borderRadius: 12, padding: '0.8rem 1rem',
                    }}>
                        <div style={{
                            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800,
                            background: step.done ? '#22c55e' : '#e2e8f0', color: step.done ? '#fff' : '#64748b',
                        }}>{step.done ? '✓' : i + 1}</div>
                        <div style={{ fontSize: '1.4rem' }}>{step.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700 }}>{step.title}
                                {step.count ? <span style={{ color: '#16a34a', fontSize: '0.8rem', marginInlineStart: '0.5rem', fontWeight: 600 }}>{step.count}</span> : null}
                            </div>
                            <div style={{ color: '#64748b', fontSize: '0.84rem' }}>{step.desc}</div>
                        </div>
                        <button onClick={() => go(step.tab)} style={{
                            background: step.done ? '#fff' : '#ff7a18', color: step.done ? '#334155' : '#fff',
                            border: step.done ? '1px solid #cbd5e1' : 'none', borderRadius: 8,
                            padding: '0.5rem 1rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>{step.done ? 'ערוך' : 'המשך ←'}</button>
                    </div>
                ))}
            </div>
        </div>
    );
}
