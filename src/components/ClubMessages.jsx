import { useMemo, useState } from 'react';

/**
 * "Floating club messages" manager.
 * Edits the banner rows (name contains "באנר") that LeagueGamesBanner renders on the
 * public site. Messages are stored across the row's content columns; saved via the
 * same Apps Script endpoint used by the schedule (no Excel links changed).
 */
export default function ClubMessages({ rawRows, currentSchedule, setCurrentSchedule, headers, indices, saveUrl, sheetName, sheetId }) {
    const base = currentSchedule || rawRows || [];
    const typeIndex = indices?.type;
    const [drafts, setDrafts] = useState(null); // { [rowIdx]: "line1\nline2" }
    const [isSaving, setIsSaving] = useState(false);

    // columns that hold banner text (everything except name(0) and the type column)
    const msgCols = useMemo(() => {
        const cols = [];
        const len = (headers && headers.length) || (base[0] ? base[0].length : 0);
        for (let c = 1; c < len; c++) {
            if (c === typeIndex) continue;
            cols.push(c);
        }
        return cols;
    }, [headers, base, typeIndex]);

    const bannerRows = useMemo(() => {
        const rows = [];
        base.forEach((row, idx) => {
            const name = (row[0] || '').trim().toLowerCase();
            if (name.includes('באנר') || name.includes('banner')) {
                const rawType = (typeIndex != null && typeIndex !== -1 && row[typeIndex]) ? row[typeIndex].trim().toLowerCase() : '';
                let audience = 'כל הקהל';
                if (['w', 'women', 'נשים', 'ילדות', 'נערות'].some(k => rawType.includes(k))) audience = 'נשים 👩';
                else if (['m', 'men', 'גברים'].some(k => rawType.includes(k))) audience = 'גברים 👨';
                const msgs = msgCols.map(c => row[c]).filter(v => v && v.trim() && !v.toLowerCase().includes('xxx'));
                rows.push({ idx, audience, text: msgs.join('\n') });
            }
        });
        return rows;
    }, [base, typeIndex, msgCols]);

    const getDraft = (idx, fallback) => (drafts && drafts[idx] != null) ? drafts[idx] : fallback;
    const setDraft = (idx, val) => setDrafts(prev => ({ ...(prev || {}), [idx]: val }));

    const handleSave = async () => {
        setIsSaving(true);
        const newData = JSON.parse(JSON.stringify(base));

        bannerRows.forEach(b => {
            const text = getDraft(b.idx, b.text);
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
            // clear message columns then write lines in order
            msgCols.forEach(c => { newData[b.idx][c] = ''; });
            lines.forEach((line, i) => { if (msgCols[i] != null) newData[b.idx][msgCols[i]] = line; });
        });

        setCurrentSchedule(newData);

        try {
            await fetch(saveUrl, {
                method: 'POST', mode: 'no-cors', cache: 'no-cache', redirect: 'follow',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ rows: [headers, ...newData], sheetName: sheetName || 'Sheet1', sheetId })
            });
            alert('ההודעות נשמרו ונשלחו לגיליון! (בדוק את האתר בעוד רגע)');
            setDrafts(null);
        } catch (e) {
            console.error(e);
            alert('שגיאה בשמירת ההודעות.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!base || base.length === 0) {
        return <div style={{ color: 'var(--text-dim)' }}>התחבר לגיליון תחילה כדי לנהל הודעות.</div>;
    }

    return (
        <div className="cc">
            <div className="cc-toolbar">
                <div className="cc-title">📣 הודעות צפות למועדון</div>
                <button className="cc-btn green" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'שומר…' : '💾 שמור ופרסם'}
                </button>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.88rem', marginBottom: '1rem' }}>
                ההודעות כאן רצות כבאנר בראש האתר. כתוב הודעה אחת בכל שורה. ניתן לפרסם בנפרד לקהל הגברים ולקהל הנשים.
            </p>

            {bannerRows.length === 0 ? (
                <div style={{ color: 'var(--text-dim)' }}>לא נמצאו שורות "באנר" בגיליון. הוסף שורה בשם "באנר" כדי לפרסם הודעות.</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '720px' }}>
                    {bannerRows.map(b => (
                        <div key={b.idx} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: '14px', padding: '1rem' }}>
                            <div style={{ fontWeight: 800, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span className="cm-badge">{b.audience}</span>
                            </div>
                            <textarea
                                value={getDraft(b.idx, b.text)}
                                onChange={e => setDraft(b.idx, e.target.value)}
                                rows={4}
                                placeholder="לדוגמה:&#10;משחק בית מול הפועל ת״א — שבת 19:00&#10;הרשמה למחנה הקיץ נפתחה"
                                className="cm-textarea"
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
