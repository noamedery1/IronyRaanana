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
            <div style={{
                background: 'rgba(12,19,36,0.96)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22,
                boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)', padding: '2.6rem 2rem', width: '100%', maxWidth: 460, textAlign: 'center',
            }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>{isError ? '⚠️' : '🔍'}</div>
                <h1 style={{ color: '#fff', fontSize: isError ? '1.5rem' : '2.6rem', fontWeight: 800, margin: '0 0 0.5rem' }}>
                    {isError ? 'אופס — משהו השתבש' : '404'}
                </h1>
                <p style={{ color: '#94a3b8', fontSize: '1.02rem', lineHeight: 1.7, margin: '0 0 1.6rem' }}>
                    {isError
                        ? 'אירעה שגיאה בלתי צפויה. נסו לרענן את הדף; אם הבעיה חוזרת, פנו למנהל המועדון. המידע שלכם בטוח.'
                        : 'הדף שחיפשתם לא נמצא — ייתכן שהקישור שגוי או שהדף הוסר.'}
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
