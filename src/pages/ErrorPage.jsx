// One styled page for both "404 — not found" and "something went wrong" (runtime
// crash via the ErrorBoundary). The buttons use window.location (not the router)
// so they work even if the router/app state is broken.
export default function ErrorPage({ mode = 'notFound' }) {
    const isError = mode === 'error';
    return (
        <div dir="rtl" style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(circle at 50% 0%, #0d1530, #070b16 70%)', fontFamily: 'Assistant, Heebo, Arial, sans-serif', padding: '1.5rem',
        }}>
            {/* Product logo on a light chip so the dark wordmark stays readable */}
            <div style={{ background: '#f8fafc', borderRadius: 14, padding: '0.5rem 1rem', marginBottom: '1.6rem', boxShadow: '0 10px 30px -12px rgba(0,0,0,0.6)' }}>
                <img src="/squadio-logo.svg" alt="Squadio" style={{ height: 38, display: 'block' }} />
            </div>

            <div style={{
                background: 'rgba(12,19,36,0.96)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 24,
                boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)', padding: '2.2rem 2rem 2.6rem', width: '100%', maxWidth: 480, textAlign: 'center',
            }}>
                {/* Sporty scoreboard illustration showing 404 (or a buzzer for errors) */}
                <svg viewBox="0 0 320 170" style={{ width: '100%', maxWidth: 280, margin: '0 auto 1.2rem', display: 'block' }} aria-hidden="true">
                    <defs>
                        <linearGradient id="ep-board" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="#16233f" /><stop offset="1" stopColor="#0a1124" />
                        </linearGradient>
                        <linearGradient id="ep-ball" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stopColor="#ff9d4d" /><stop offset="1" stopColor="#f97316" />
                        </linearGradient>
                    </defs>
                    {/* stand posts */}
                    <rect x="58" y="118" width="8" height="40" rx="3" fill="#1e293b" />
                    <rect x="254" y="118" width="8" height="40" rx="3" fill="#1e293b" />
                    {/* board */}
                    <rect x="30" y="26" width="260" height="100" rx="16" fill="url(#ep-board)" stroke="rgba(56,189,248,0.35)" strokeWidth="2" />
                    <rect x="30" y="26" width="260" height="26" rx="13" fill="rgba(56,189,248,0.12)" />
                    <circle cx="48" cy="39" r="4" fill="#38bdf8" />
                    <text x="160" y="44" textAnchor="middle" fontFamily="Heebo, Arial, sans-serif" fontSize="13" fontWeight="700" fill="#7dd3fc">SQUADIO · LIVE</text>
                    {/* the digits */}
                    <text x="160" y="104" textAnchor="middle" fontFamily="'Courier New', monospace" fontSize="56" fontWeight="800" letterSpacing="6" fill="#34d399">
                        {isError ? 'Oops' : '404'}
                    </text>
                    {/* bouncing ball with seams */}
                    <g transform="translate(232,128)">
                        <circle r="17" fill="url(#ep-ball)" />
                        <path d="M-17 0 H17 M0 -17 V17 M-12 -12 Q0 0 -12 12 M12 -12 Q0 0 12 12" fill="none" stroke="#7c2d12" strokeWidth="1.6" strokeOpacity="0.7" />
                    </g>
                </svg>

                <h1 style={{ color: '#fff', fontSize: '1.55rem', fontWeight: 800, margin: '0 0 0.5rem' }}>
                    {isError ? 'אוי, משהו השתבש 🛠️' : 'אופס! הכדור יצא מהמגרש 🏀'}
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '1.02rem', lineHeight: 1.7, margin: '0 0 1.6rem' }}>
                    {isError
                        ? 'אנחנו כבר על זה ובודקים מה קרה. נסו לרענן את הדף — אם זה חוזר, פנו למנהל המועדון. המידע שלכם בטוח. 🙂'
                        : 'העמוד שחיפשתם לא נמצא — אולי הקישור שגוי או שהדף עדיין בבנייה. בואו נחזיר אתכם למגרש.'}
                </p>
                <div style={{ display: 'flex', gap: '0.7rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => window.location.reload()} style={{
                        background: 'linear-gradient(135deg,#3b82f6,#22d3ee)', color: '#04263a', border: 'none', fontWeight: 800,
                        padding: '0.8rem 1.5rem', borderRadius: 999, cursor: 'pointer', fontSize: '1rem', fontFamily: 'inherit',
                    }}>↻ רענן</button>
                    <button onClick={() => { window.location.href = '/'; }} style={{
                        background: 'rgba(255,255,255,0.06)', color: '#e8edf7', border: '1px solid rgba(255,255,255,0.16)', fontWeight: 700,
                        padding: '0.8rem 1.5rem', borderRadius: 999, cursor: 'pointer', fontSize: '1rem', fontFamily: 'inherit',
                    }}>דף הבית</button>
                </div>
            </div>
        </div>
    );
}
