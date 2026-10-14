import { useState } from 'react';
import { gamesPdfToEntries, gameLine } from '../utils/gamesParse.js';
import { gkTextToEntries, gkWhatsApp } from '../utils/gkParse.js';

// Two manager tools that ADD entries on top of the existing draft (never replace):
//  • "פרסום משחקים": upload the weekend-games PDF → auto-place each game on its team's day.
//  • "לו"ז שוערים": paste the goalkeeper coach's WhatsApp text → add colour-coded GK trainings
//    and get a tidy WhatsApp message back.
// Parsing happens here; the actual merge into the draft + save is done by the parent (onMerge),
// which then returns how many teams matched so the manager can fix the rest in the preview.
export default function SpecialSchedule({ mode, onMerge, goPreview }) {
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [result, setResult] = useState(null); // { matched, unmatched, warnings }
    const [gkText, setGkText] = useState('');
    const [whatsapp, setWhatsapp] = useState('');

    const runGames = async (file) => {
        if (!file) return;
        setBusy(true); setErr(''); setResult(null); setWhatsapp('');
        try {
            const { entries, warnings } = await gamesPdfToEntries(file);
            const lines = entries.map((e) => ({ team: e.team, dow: e.dow, line: gameLine(e) }));
            const res = await onMerge(lines);
            setResult({ ...res, warnings });
        } catch (e) { setErr(e.message || 'שגיאה בקריאת הקובץ'); }
        finally { setBusy(false); }
    };

    const runGk = async () => {
        if (!gkText.trim()) { setErr('הדבק את טקסט אימון השוערים'); return; }
        setBusy(true); setErr(''); setResult(null); setWhatsapp('');
        try {
            const { entries, warnings, dayName } = gkTextToEntries(gkText);
            const lines = entries.map((e) => ({ team: e.team, dow: e.dow, line: e.line }));
            const res = await onMerge(lines);
            setResult({ ...res, warnings });
            setWhatsapp(gkWhatsApp(entries, dayName));
        } catch (e) { setErr(e.message || 'שגיאה בפענוח הטקסט'); }
        finally { setBusy(false); }
    };

    const panel = { marginTop: 0, color: '#0f1b33' };
    const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', padding: '0.7rem 1.3rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontWeight: 'bold' });

    return (
        <div className="report-panel" style={panel}>
            {mode === 'games' ? (
                <>
                    <h3 style={{ marginTop: 0 }}>🏀 פרסום משחקים</h3>
                    <p style={{ color: '#666', maxWidth: 680 }}>
                        העלה את קובץ המשחקים (PDF). המערכת תזהה לכל משחק את <b>הקבוצה, היום והשעה</b> ותוסיף אותו
                        ל<b>טיוטה הקיימת</b> ביום הנכון — <b>בנוסף</b> לאימונים, לא במקומם. לאחר מכן עבור ל<b>תצוגה מקדימה</b>,
                        בדוק/תקן ורק אז פרסם.
                    </p>
                    <label style={{ ...btn('#ff7a18'), display: 'inline-block' }}>
                        {busy ? 'קורא…' : '⬆ העלה קובץ משחקים (PDF)'}
                        <input type="file" accept=".pdf" style={{ display: 'none' }}
                            onChange={(e) => { runGames(e.target.files[0]); e.target.value = ''; }} />
                    </label>
                </>
            ) : (
                <>
                    <h3 style={{ marginTop: 0 }}>🧤 לו"ז שוערים</h3>
                    <p style={{ color: '#666', maxWidth: 680 }}>
                        הדבק את הטקסט של מאמן השוערים (קבוצות + שעות, כפי שהוא שולח בוואטסאפ). המערכת תוסיף
                        <b> אימון שוערים</b> בצבע מיוחד ללו"ז של כל קבוצה ביום הרלוונטי, ותכין לך גם <b>טקסט וואטסאפ מסודר</b>.
                    </p>
                    <textarea value={gkText} onChange={(e) => setGkText(e.target.value)} rows={8}
                        placeholder={'לדוגמה:\nאימון שוערים יום ראשון\nנוער\n15:00 - 15:30\nילדים א + ילדים ב\n16:00 - 16:30'}
                        style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', resize: 'vertical' }} />
                    <button onClick={runGk} disabled={busy} style={{ ...btn('#a855f7'), marginTop: '0.8rem' }}>
                        {busy ? 'מוסיף…' : '🧤 הוסף אימוני שוערים ללו"ז'}
                    </button>
                </>
            )}

            {err && <div style={{ marginTop: '1rem', color: '#dc2626', fontWeight: 700 }}>⚠️ {err}</div>}

            {result && (
                <div style={{ marginTop: '1.2rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.9rem 1rem' }}>
                    <div style={{ fontWeight: 800, color: '#065f46' }}>✓ נוספו {result.matched?.length || 0} רשומות לטיוטה.</div>
                    {result.unmatched?.length > 0 && (
                        <div style={{ marginTop: '0.6rem', color: '#92400e' }}>
                            <b>לא שויכו {result.unmatched.length} (שם קבוצה לא זוהה):</b>
                            <ul style={{ margin: '0.3rem 0 0', paddingInlineStart: '1.2rem' }}>
                                {result.unmatched.map((u, i) => <li key={i}>{u.team} — {u.line}</li>)}
                            </ul>
                            <div style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>הוסף אותם ידנית בתצוגה המקדימה.</div>
                        </div>
                    )}
                    {result.warnings?.length > 0 && (
                        <ul style={{ margin: '0.6rem 0 0', paddingInlineStart: '1.2rem', color: '#92400e', fontSize: '0.85rem' }}>
                            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                    )}
                    <button onClick={goPreview} style={{ ...btn('#2563eb'), marginTop: '0.8rem' }}>👁 עבור לתצוגה מקדימה</button>
                </div>
            )}

            {whatsapp && (
                <div style={{ marginTop: '1.2rem' }}>
                    <div style={{ fontWeight: 800, marginBottom: '0.4rem', color: '#0f1b33' }}>📋 טקסט וואטסאפ מסודר</div>
                    <textarea readOnly value={whatsapp} rows={Math.min(14, whatsapp.split('\n').length + 1)}
                        style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', direction: 'rtl' }} />
                    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <button onClick={() => { navigator.clipboard?.writeText(whatsapp); }} style={btn('#64748b')}>📋 העתק</button>
                        <button onClick={() => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(whatsapp)}`, '_blank')} style={btn('#25D366')}>💬 שתף בוואטסאפ</button>
                    </div>
                </div>
            )}
        </div>
    );
}
