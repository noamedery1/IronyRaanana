import { useState, useEffect, useCallback } from 'react';

// Superuser console (general manager). Password-gated. Lets you add/edit clubs and
// upload their logo/icons without touching code — images are stored in the DB and
// served (cached) from /api/:club/icon/:kind, so a DB backup carries everything.

const FILE_TO_DATAURL = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
});

const EMPTY = {
    slug: '', name: '', shortName: '', themeColor: '#ff7a18', backgroundColor: '#070b16',
    dataUrl: '', publishUrl: '', sheetApi: '', sport: '', managerEmails: '',
};

const inputStyle = {
    width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid #334155',
    background: '#0b1220', color: '#e2e8f0', outline: 'none', fontFamily: 'inherit',
};
const labelStyle = { display: 'block', margin: '0 0 0.3rem', fontSize: '0.85rem', color: '#94a3b8' };

export default function SuperUser() {
    const [token, setToken] = useState(() => localStorage.getItem('superuserToken') || '');
    const [password, setPassword] = useState('');
    const [loginErr, setLoginErr] = useState('');
    const [clubs, setClubs] = useState([]);
    const [form, setForm] = useState(EMPTY);
    const [icons, setIcons] = useState({});
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);
    const [mgr, setMgr] = useState({ slug: '', username: '', password: '', name: '' });
    const [mgrMsg, setMgrMsg] = useState('');
    const [delTarget, setDelTarget] = useState(null); // club slug pending deletion (confirm modal)
    const [delMsg, setDelMsg] = useState('');

    // This is the system console, not a club — keep a neutral tab title (not "raanana").
    useEffect(() => { document.title = 'Squadio — ניהול מערכת'; }, []);

    const loadClubs = useCallback(async () => {
        const res = await fetch('/api/clubs');
        if (res.ok) setClubs(await res.json());
    }, []);

    useEffect(() => { loadClubs(); }, [loadClubs]);

    const login = async (e) => {
        e.preventDefault();
        setLoginErr('');
        const res = await fetch('/api/superuser/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.token) {
            setToken(data.token);
            localStorage.setItem('superuserToken', data.token);
        } else {
            setLoginErr(data.error === 'superuser not configured'
                ? 'מסך הניהול עדיין לא הוגדר (חסר SUPERUSER_PASSWORD בשרת).'
                : 'סיסמה שגויה.');
        }
    };

    const logout = () => { setToken(''); localStorage.removeItem('superuserToken'); };

    const onIcon = async (kind, file) => {
        if (!file) return;
        const dataUrl = await FILE_TO_DATAURL(file);
        setIcons((p) => ({ ...p, [kind]: dataUrl }));
    };

    const editClub = (c) => {
        setForm({
            slug: c.slug, name: c.name, shortName: c.shortName || '', themeColor: c.themeColor || '#ff7a18',
            backgroundColor: c.backgroundColor || '#070b16', dataUrl: c.dataUrl || '', publishUrl: c.publishUrl || '',
            sheetApi: c.sheetApi || '', sport: c.sport || '',
            managerEmails: Array.isArray(c.managerEmails) ? c.managerEmails.join(', ') : (c.managerEmails || ''),
            // carry existing image URLs so re-saving without re-uploading keeps them
            icon192: c.icon192 || '', icon512: c.icon512 || '', appleIcon: c.appleIcon || '', logo: c.logo || '',
        });
        setIcons({});
        setMsg('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const save = async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg('');
        try {
            // One sheet field in the UI (publishUrl). Mirror it to dataUrl so the public
            // CSV-fallback also has a source before the first publish.
            const club = { ...form, dataUrl: form.publishUrl || form.dataUrl };
            const res = await fetch('/api/superuser/clubs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-superuser-token': token },
                body: JSON.stringify({ club, icons }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 401) { logout(); return; }
            if (!res.ok) { setMsg('❌ ' + (data.error || 'שמירה נכשלה')); return; }
            setMsg('✓ נשמר! המועדון זמין בכתובת /' + form.slug);
            setForm(EMPTY);
            setIcons({});
            loadClubs();
        } finally {
            setBusy(false);
        }
    };

    const createManagerInvite = async (e) => {
        e.preventDefault();
        setMgrMsg('');
        if (!mgr.slug || !mgr.username || !mgr.password) { setMgrMsg('בחר מועדון, שם משתמש וסיסמה'); return; }
        const res = await fetch(`/api/superuser/clubs/${mgr.slug}/managers`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-superuser-token': token },
            body: JSON.stringify({ username: mgr.username, password: mgr.password, name: mgr.name }),
        });
        if (res.status === 401) { logout(); return; }
        const d = await res.json().catch(() => ({}));
        setMgrMsg(res.ok ? `✓ נוצר מנהל "${mgr.username}" למועדון ${mgr.slug}` : '❌ ' + (d.error || 'נכשל'));
        if (res.ok) setMgr({ slug: mgr.slug, username: '', password: '', name: '' });
    };

    // Two-step delete: the "מחק" button opens a confirm modal; this runs on final confirm.
    const confirmDelete = async () => {
        const slug = delTarget;
        if (!slug) return;
        setDelTarget(null);
        setDelMsg('מוחק…');
        try {
            const res = await fetch('/api/superuser/clubs/' + slug, {
                method: 'DELETE', headers: { 'x-superuser-token': token },
            });
            if (res.status === 401) { setDelMsg(''); logout(); return; }
            const d = await res.json().catch(() => ({}));
            if (res.ok) {
                setClubs((prev) => prev.filter((c) => c.slug !== slug)); // optimistic — drop the row now
                setDelMsg(`✓ המועדון "${slug}" נמחק לצמיתות`);
                loadClubs();
            } else setDelMsg('❌ ' + (d.error || 'מחיקה נכשלה'));
        } catch { setDelMsg('❌ שגיאת תקשורת'); }
        setTimeout(() => setDelMsg(''), 5000);
    };

    const wrap = { minHeight: '100vh', background: '#070b16', color: '#e2e8f0', fontFamily: 'Rubik, sans-serif', direction: 'rtl', padding: '2rem 1rem' };
    const card = { maxWidth: '640px', margin: '0 auto', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '16px', padding: '1.5rem' };

    if (!token) {
        return (
            <div style={wrap}>
                <div style={{ ...card, maxWidth: '380px' }}>
                    <h2 style={{ marginTop: 0, textAlign: 'center' }}>🔐 מסך ניהול־על</h2>
                    <form onSubmit={login}>
                        <label style={labelStyle}>סיסמת SUPERUSER</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoFocus />
                        <button type="submit" style={{ width: '100%', marginTop: '1rem', padding: '0.7rem', border: 'none', borderRadius: '10px', background: '#ff7a18', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>כניסה</button>
                        {loginErr && <div style={{ marginTop: '0.8rem', color: '#f87171', textAlign: 'center', fontSize: '0.9rem' }}>{loginErr}</div>}
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div style={wrap}>
            <div style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h2 style={{ margin: 0 }}>🏟️ ניהול מועדונים</h2>
                    <button onClick={logout} style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: '8px', padding: '0.4rem 0.8rem', cursor: 'pointer' }}>יציאה</button>
                </div>

                <form onSubmit={save} style={{ display: 'grid', gap: '0.8rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                        <div><label style={labelStyle}>מזהה בכתובת (slug) — אותיות קטנות באנגלית</label><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder="hapoel" style={inputStyle} /></div>
                        <div><label style={labelStyle}>שם מלא</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder='הפועל ... — לו"ז' style={inputStyle} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                        <div><label style={labelStyle}>שם קצר (לאייקון)</label><input value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} placeholder='הפועל לו"ז' style={inputStyle} /></div>
                        <div style={{ display: 'flex', gap: '0.8rem' }}>
                            <div style={{ flex: 1 }}><label style={labelStyle}>צבע ראשי</label><input type="color" value={form.themeColor} onChange={(e) => setForm({ ...form, themeColor: e.target.value })} style={{ ...inputStyle, padding: '0.2rem', height: '42px' }} /></div>
                            <div style={{ flex: 1 }}><label style={labelStyle}>צבע רקע</label><input type="color" value={form.backgroundColor} onChange={(e) => setForm({ ...form, backgroundColor: e.target.value })} style={{ ...inputStyle, padding: '0.2rem', height: '42px' }} /></div>
                        </div>
                    </div>
                    <div><label style={labelStyle}>קישור ללוז המנהל (Google Sheet CSV) — המערכת קוראת ממנו בלחיצת "פרסם לוז"</label><input value={form.publishUrl} onChange={(e) => setForm({ ...form, publishUrl: e.target.value })} placeholder="https://docs.google.com/.../export?format=csv&gid=0" style={{ ...inputStyle, direction: 'ltr' }} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.8rem' }}>
                        <div><label style={labelStyle}>ענף</label><input value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })} placeholder="football / basketball" style={{ ...inputStyle, direction: 'ltr' }} /></div>
                        <div><label style={{ ...labelStyle, color: '#fbbf24' }}>📧 מיילי מנהלים לקבלת בקשות לאישור (מופרד בפסיק)</label><input value={form.managerEmails} onChange={(e) => setForm({ ...form, managerEmails: e.target.value })} placeholder="manager@club.com, second@club.com" style={{ ...inputStyle, direction: 'ltr', border: '1px solid #fbbf24' }} /></div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                        <div><label style={{ ...labelStyle, color: '#22d3ee' }}>🏆 לוגו המועדון (מוצג בכותרת ובדף הכניסה)</label><input type="file" accept="image/*" onChange={(e) => onIcon('logo', e.target.files[0])} style={{ ...inputStyle, padding: '0.4rem', border: '1px solid #22d3ee' }} /></div>
                        <div><label style={labelStyle}>אייקון אפליקציה 512px</label><input type="file" accept="image/png" onChange={(e) => onIcon('i512', e.target.files[0])} style={{ ...inputStyle, padding: '0.4rem' }} /></div>
                        <div><label style={labelStyle}>אייקון 192px</label><input type="file" accept="image/png" onChange={(e) => onIcon('i192', e.target.files[0])} style={{ ...inputStyle, padding: '0.4rem' }} /></div>
                        <div><label style={labelStyle}>Apple icon</label><input type="file" accept="image/png" onChange={(e) => onIcon('apple', e.target.files[0])} style={{ ...inputStyle, padding: '0.4rem' }} /></div>
                    </div>

                    <button type="submit" disabled={busy} style={{ padding: '0.8rem', border: 'none', borderRadius: '10px', background: '#ff7a18', color: '#fff', fontWeight: 'bold', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>{busy ? 'שומר...' : 'שמור מועדון'}</button>
                    {msg && <div style={{ textAlign: 'center', fontSize: '0.9rem', color: msg.startsWith('✓') ? '#34d399' : '#f87171' }}>{msg}</div>}
                </form>

                <h3 style={{ marginTop: '2rem', marginBottom: '0.6rem', fontSize: '1rem', color: '#94a3b8' }}>מועדונים קיימים</h3>
                {delMsg && <div style={{ marginBottom: '0.6rem', fontWeight: 'bold', color: delMsg.startsWith('✓') ? '#34d399' : '#f87171' }}>{delMsg}</div>}
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {clubs.map((c) => (
                        <div key={c.slug} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: '#0b1220', border: '1px solid #1e293b', borderRadius: '10px', padding: '0.6rem 0.8rem' }}>
                            <img src={c.icon192} alt="" style={{ width: 34, height: 34, borderRadius: 8 }} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 'bold' }}>{c.name}</div>
                                <a href={'/' + c.slug} style={{ color: '#60a5fa', fontSize: '0.8rem', textDecoration: 'none' }}>/{c.slug}</a>
                            </div>
                            <button onClick={() => editClub(c)} style={{ background: 'none', border: '1px solid #334155', color: '#cbd5e1', borderRadius: '8px', padding: '0.35rem 0.7rem', cursor: 'pointer' }}>עריכה</button>
                            {c.slug !== 'raanana' && <button onClick={() => setDelTarget(c.slug)} style={{ background: 'none', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: '8px', padding: '0.35rem 0.7rem', cursor: 'pointer' }}>מחק</button>}
                        </div>
                    ))}
                </div>

                <h3 style={{ marginTop: '2rem', marginBottom: '0.6rem', fontSize: '1rem', color: '#94a3b8' }}>הקמת מנהל למועדון (כניסה לאפליקציית מנהל)</h3>
                <form onSubmit={createManagerInvite} style={{ display: 'grid', gap: '0.6rem' }}>
                    <select value={mgr.slug} onChange={(e) => setMgr({ ...mgr, slug: e.target.value })} style={inputStyle}>
                        <option value="">בחר מועדון…</option>
                        {clubs.map((c) => <option key={c.slug} value={c.slug}>{c.name} (/{c.slug})</option>)}
                    </select>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                        <input value={mgr.username} onChange={(e) => setMgr({ ...mgr, username: e.target.value })} placeholder="שם משתמש" style={{ ...inputStyle, direction: 'ltr' }} />
                        <input value={mgr.password} onChange={(e) => setMgr({ ...mgr, password: e.target.value })} placeholder="סיסמה ראשונית" style={{ ...inputStyle, direction: 'ltr' }} />
                    </div>
                    <input value={mgr.name} onChange={(e) => setMgr({ ...mgr, name: e.target.value })} placeholder="שם המנהל (אופציונלי)" style={inputStyle} />
                    <button type="submit" style={{ padding: '0.7rem', border: 'none', borderRadius: '10px', background: '#2563eb', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>➕ צור מנהל</button>
                    {mgrMsg && <div style={{ textAlign: 'center', fontSize: '0.9rem', color: mgrMsg.startsWith('✓') ? '#34d399' : '#f87171' }}>{mgrMsg}</div>}
                </form>
                <p style={{ color: '#64748b', fontSize: '0.78rem', marginTop: '0.5rem', lineHeight: 1.5 }}>
                    המנהל יתחבר ב-<code>/&lt;slug&gt;/admin</code> (הכתובת של המועדון שלו) עם הפרטים, וילחץ "🔔 התראות מנהל" כדי לקבל בקשות שינוי ולאשר ישירות מההתראה.
                </p>
            </div>

            {/* Delete confirmation — irreversible, so require an explicit second step */}
            {delTarget && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, direction: 'rtl' }} onClick={() => setDelTarget(null)}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid #7f1d1d', borderRadius: 16, padding: '1.6rem', width: '90%', maxWidth: 420, boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)' }}>
                        <h3 style={{ margin: '0 0 0.6rem', color: '#f87171' }}>⚠️ מחיקת מועדון</h3>
                        <p style={{ color: '#e2e8f0', lineHeight: 1.7, margin: '0 0 1.2rem' }}>
                            למחוק לצמיתות את <b>"{delTarget}"</b>?<br />
                            כל הנתונים של המועדון יימחקו — מנהלים, מאמנים, קבוצות, אימונים, פרסומים, הגדרות ובקשות. <b>פעולה זו בלתי הפיכה.</b>
                        </p>
                        <div style={{ display: 'flex', gap: '0.8rem' }}>
                            <button onClick={() => setDelTarget(null)} style={{ flex: 1, padding: '0.7rem', borderRadius: 10, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontWeight: 700 }}>ביטול</button>
                            <button onClick={confirmDelete} style={{ flex: 1, padding: '0.7rem', borderRadius: 10, border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>כן, מחק לצמיתות</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
