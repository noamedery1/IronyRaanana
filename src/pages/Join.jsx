import { useState } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { setIdentity, registerIdentityPush } from '../userIdentity.js';

// Invite-based registration. Opened from a manager-generated link:
//   /<club>/join?r=member&team=<teamLabel>   (parent/trainee of a team)
//   /<club>/join?r=operator                   (operator — full board view)
export default function Join() {
    const params = new URLSearchParams(window.location.search);
    const role = params.get('r') === 'operator' ? 'operator' : 'member';
    const team = params.get('team') || '';

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const slug = getActiveClub().slug;
    const roleLabel = role === 'operator' ? 'מפעיל' : 'חבר קבוצה';

    const submit = async (e) => {
        e.preventDefault();
        if (!name.trim() || (!email.trim() && !phone.trim())) {
            setError('מלאו שם ולפחות מייל או טלפון');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/${slug}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, team, name, email, phone }),
            });
            const data = await res.json();
            if (!data.valid) { setError(data.error || 'הרשמה נכשלה'); return; }
            setIdentity({ token: data.token, role: data.role, team: data.team, name: data.name });
            registerIdentityPush(data.role, data.team).catch(() => {}); // best-effort push opt-in
            window.location.href = `/${slug}`; // enter the app in the right view
        } catch (err) {
            console.error(err);
            setError('שגיאת תקשורת, נסו שוב');
        } finally {
            setLoading(false);
        }
    };

    const inp = {
        padding: '0.85rem', borderRadius: '10px', border: '1px solid #243049',
        background: '#0b1220', color: '#e8edf7', outline: 'none', fontFamily: 'inherit', fontSize: '0.95rem',
    };

    return (
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'radial-gradient(circle at 50% 0%, #0d1530, #070b16 70%)', fontFamily: 'Assistant, sans-serif', padding: '1rem' }}>
            <div style={{ background: 'rgba(12,19,36,0.96)', padding: '2rem 1.6rem', borderRadius: '20px', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.08)', width: '90%', maxWidth: '380px', textAlign: 'center' }}>
                <div style={{ width: 60, height: 60, margin: '0 auto 0.9rem', borderRadius: 16, background: 'linear-gradient(135deg,#3b82f6,#0891b2)', display: 'grid', placeItems: 'center', fontSize: 28 }}>🏀</div>
                <h2 style={{ color: '#fff', margin: '0 0 0.3rem', fontSize: '1.3rem', fontWeight: 800 }}>הצטרפות למערכת</h2>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 0.4rem' }}>{getActiveClub().shortName}</p>
                <div style={{ display: 'inline-block', background: 'rgba(56,189,248,0.15)', color: '#a5f3fc', borderRadius: 20, padding: '0.25rem 0.9rem', fontSize: '0.82rem', fontWeight: 700, marginBottom: '1.3rem' }}>
                    {roleLabel}{team ? ' · ' + team : ''}
                </div>
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם מלא" style={inp} />
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="אימייל" style={{ ...inp, direction: 'ltr', textAlign: 'right' }} />
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="טלפון" style={{ ...inp, direction: 'ltr', textAlign: 'right' }} />
                    <button type="submit" disabled={loading} style={{ background: 'linear-gradient(135deg,#3b82f6,#0891b2)', color: '#fff', border: 'none', padding: '0.85rem', borderRadius: '12px', fontWeight: 800, fontFamily: 'inherit', fontSize: '1rem', cursor: loading ? 'wait' : 'pointer', marginTop: '0.3rem' }}>
                        {loading ? 'נרשם...' : 'הצטרפות'}
                    </button>
                </form>
                {error && <div style={{ color: '#f87171', marginTop: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                <p style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '1.2rem', lineHeight: 1.5 }}>בהצטרפות תקבלו עדכונים על הלו"ז הרלוונטי אליכם.</p>
            </div>
        </div>
    );
}
