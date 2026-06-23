// Shown for any URL that isn't tied to a real club (e.g. /admin, /trainer, an
// unknown slug). Registration/login is only possible from a club link (/<slug>/…).
export default function NoClub() {
    return (
        <div dir="rtl" style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(circle at 50% 0%, #0d1530, #070b16 70%)', fontFamily: 'Assistant, sans-serif', padding: '1.5rem',
        }}>
            <div style={{
                background: 'rgba(12,19,36,0.96)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 22,
                boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)', padding: '2.5rem 2rem', width: '100%', maxWidth: 440, textAlign: 'center',
            }}>
                <div style={{ fontSize: '2.6rem', marginBottom: '0.6rem' }}>🔗</div>
                <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.6rem' }}>הדף אינו מחובר למועדון</h1>
                <p style={{ color: '#94a3b8', fontSize: '1rem', lineHeight: 1.7, margin: '0 0 1.6rem' }}>
                    הקישור שפתחת אינו כולל מועדון. כדי להיכנס או להירשם יש להשתמש בקישור
                    האישי שקיבלת ממנהל המועדון. אם אין לך קישור — פנה למנהל המועדון.
                </p>
                <a href="/sales-landing.html" style={{
                    display: 'inline-block', textDecoration: 'none', fontWeight: 800, fontSize: '1.02rem', color: '#04263a',
                    background: 'linear-gradient(135deg,#3b82f6,#22d3ee)', padding: '0.85rem 1.7rem', borderRadius: 999,
                    boxShadow: '0 12px 30px -12px rgba(34,211,238,0.7)',
                }}>
                    מה זה Squadio? לדף המכירות ←
                </a>
            </div>
        </div>
    );
}
