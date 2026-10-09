import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getActiveClub } from '../clubConfig.js';
import BrandMark from '../components/BrandMark';
import { addMembership, getIdentity, getMemberships, registerIdentityPush } from '../userIdentity.js';
import { isInAppBrowser, isIOS } from '../inAppBrowser.js';
import { encodePathSeg } from '../encodeSeg.js';

// Invite-based registration. Opened from a manager-generated link:
//   /<club>/join?r=member&team=<teamLabel>   (parent/trainee of a team)
//   /<club>/join?r=operator                   (operator — full board view)
export default function Join() {
    // Role/team come from the PATH first (/:club/join/:role[/:team]) — iOS-safe, survives install —
    // and fall back to the legacy query (?r=operator&team=…) so links already sent keep working.
    const { role: pathRole, team: pathTeam } = useParams();
    const params = new URLSearchParams(window.location.search);
    const role = (pathRole === 'operator' || params.get('r') === 'operator') ? 'operator' : 'member';
    let team = '';
    try { team = pathTeam ? decodeURIComponent(pathTeam) : (params.get('team') || ''); } catch { team = params.get('team') || ''; }

    const [name, setName] = useState(getIdentity().name || ''); // prefill for a returning parent adding another team
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const slug = getActiveClub().slug;
    const roleLabel = role === 'operator' ? 'מפעיל' : 'חבר קבוצה';

    // In WhatsApp/Instagram/etc. in-app browsers (esp. on iOS) storage is ephemeral — a sign-up there
    // won't be remembered. Steer the user to real Safari, where it persists.
    const inApp = isInAppBrowser();
    const [copied, setCopied] = useState(false);
    const copyLink = () => {
        const url = window.location.href;
        navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
    };

    // Mark how this device entered so the installed app's start page routes correctly:
    // a member/operator link → its own registration (never the trainer portal).
    localStorage.setItem('entryRole', role);
    if (team) localStorage.setItem('entryTeam', team);

    // The invite path (PATH-only, no query — iOS strips the query from a PWA start_url), used both to
    // skip-if-registered and as the installed icon's start_url.
    const joinPath = `/${slug}/join/${role}` + (team ? `/${encodePathSeg(team)}` : '');

    // On iOS, Add-to-Home-Screen uses the manifest start_url (not the current URL), so a plain icon
    // opens "/<club>" and loses the operator/team context — the installed app then can't tell who they
    // are. Point this page's manifest at the invite URL so the icon opens the registration/enter flow.
    useEffect(() => {
        const link = document.querySelector('link[rel="manifest"]');
        if (!link) return;
        const prev = link.getAttribute('href');
        link.setAttribute('href', `/clubs/${slug}.webmanifest?start=${encodeURIComponent(joinPath)}`);
        return () => { if (prev) link.setAttribute('href', prev); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);

    // Already registered in THIS storage context (e.g. reopening the installed icon) → go to the board,
    // don't ask again.
    useEffect(() => {
        const id = getIdentity();
        const done = role === 'operator'
            ? id.role === 'operator'
            : (!!team && getMemberships().some((m) => m.team === team));
        if (done) window.location.replace(`/${slug}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const submit = async (e) => {
        e.preventDefault();
        if (!name.trim() || !email.trim()) {
            setError('מלאו שם וכתובת מייל');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const res = await fetch(`/api/${slug}/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, team, name, email }),
            });
            const data = await res.json();
            if (!data.valid) { setError(data.error || 'הרשמה נכשלה'); return; }
            addMembership({ token: data.token, role: data.role, team: data.team, name: data.name }); // adds team, keeps existing
            registerIdentityPush(data.role, data.team).catch(() => {}); // best-effort push opt-in (this team)
            // Enter via a personal link so identity also travels in the URL — survives contexts where
            // localStorage doesn't (iOS in-app browsers / installed-PWA storage isolation).
            const q = `u=${encodeURIComponent(data.token)}&r=${encodeURIComponent(data.role)}` + (data.team ? `&team=${encodeURIComponent(data.team)}` : '');
            window.location.href = `/${slug}?${q}`;
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
        <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: 'radial-gradient(circle at 50% 0%, #0d1530, #070b16 70%)', fontFamily: 'Assistant, sans-serif', padding: '1rem' }}>
            <div style={{ background: 'rgba(12,19,36,0.96)', padding: '2rem 1.6rem', borderRadius: '20px', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.9)', border: '1px solid rgba(255,255,255,0.08)', width: '90%', maxWidth: '380px', textAlign: 'center' }}>
                <BrandMark size={60} />
                <h2 style={{ color: '#fff', margin: '0 0 0.3rem', fontSize: '1.3rem', fontWeight: 800 }}>הצטרפות למערכת</h2>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 0.4rem' }}>{getActiveClub().shortName}</p>
                <div style={{ display: 'inline-block', background: 'rgba(56,189,248,0.15)', color: '#a5f3fc', borderRadius: 20, padding: '0.25rem 0.9rem', fontSize: '0.82rem', fontWeight: 700, marginBottom: '1.3rem' }}>
                    {roleLabel}{team ? ' · ' + team : ''}
                </div>

                {inApp && (
                    <div style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.5)', borderRadius: 14, padding: '0.9rem 1rem', marginBottom: '1.2rem', textAlign: 'right' }}>
                        <div style={{ color: '#fde68a', fontWeight: 800, marginBottom: '0.4rem' }}>⚠️ פתחו בדפדפן ספארי</div>
                        <div style={{ color: '#e2e8f0', fontSize: '0.86rem', lineHeight: 1.6 }}>
                            נכנסתם מתוך וואטסאפ/אפליקציה אחרת — הרשמה כאן <b>לא תישמר</b>.
                            {isIOS()
                                ? ' לחצו על כפתור השיתוף / ⋯ למטה ובחרו "פתח בספארי" (Open in Safari), ואז הירשמו.'
                                : ' לחצו על ⋮ למעלה ובחרו "פתח בדפדפן" (Chrome), ואז הירשמו.'}
                        </div>
                        <button type="button" onClick={copyLink} style={{ marginTop: '0.7rem', background: '#f59e0b', color: '#111', border: 'none', borderRadius: 10, padding: '0.5rem 1rem', fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                            {copied ? '✓ הועתק — הדביקו בספארי' : '📋 העתק קישור'}
                        </button>
                    </div>
                )}
                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם מלא" style={inp} />
                    <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="אימייל" style={{ ...inp, direction: 'ltr', textAlign: 'right' }} />
                    <button type="submit" disabled={loading} style={{ background: 'linear-gradient(135deg,#3b82f6,#0891b2)', color: '#fff', border: 'none', padding: '0.85rem', borderRadius: '12px', fontWeight: 800, fontFamily: 'inherit', fontSize: '1rem', cursor: loading ? 'wait' : 'pointer', marginTop: '0.3rem' }}>
                        {loading ? 'נרשם...' : 'הצטרפות'}
                    </button>
                </form>
                {error && <div style={{ color: '#f87171', marginTop: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                <p style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '1.2rem', lineHeight: 1.5 }}>
                    בהצטרפות תקבלו עדכונים על הלו"ז הרלוונטי אליכם, ואתם מאשרים את <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: '#5eead4' }}>מדיניות הפרטיות</a>.
                </p>
            </div>
        </div>
    );
}
