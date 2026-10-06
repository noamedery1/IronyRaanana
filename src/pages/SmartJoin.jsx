import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { isNativeApp } from '../native.js';
import { isIOS } from '../inAppBrowser.js';
import { encodePathSeg } from '../encodeSeg.js';
import { playStoreUrl, appStoreUrl } from '../appStores.js';
import { getMemberships, setActiveTeam } from '../userIdentity.js';

const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent || '');

// SMART LINK — one link per team (squadio.techbynoam.com/s/<code>) that "just works":
//  • inside the app, or on desktop → go straight to that team's join flow (no store detour)
//  • on a phone browser → offer install (correct store; Android carries the code as install
//    referrer), a "continue in browser" option, and ALWAYS show the CODE so the loop closes even
//    when auto-delivery can't fire (iOS has no install referrer). After install, the parent types
//    the code on /:club/code. This is the guaranteed cross-platform fallback.
export default function SmartJoin() {
    const { code } = useParams();
    const navigate = useNavigate();
    const [state, setState] = useState({ loading: true });

    useEffect(() => {
        let alive = true;
        fetch(`/api/join/${encodeURIComponent(code)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!alive) return;
                if (!d) { setState({ loading: false, error: true }); return; }
                // Already registered to this team on this device → straight to the schedule.
                const alreadyMember = getMemberships().some((m) => m.team === d.team);
                const joinPath = alreadyMember ? `/${d.clubSlug}` : `/${d.clubSlug}/join/member/${encodePathSeg(d.team)}`;
                if (alreadyMember) setActiveTeam(d.team);
                // In the app, or on a desktop browser → no store step; go straight in.
                if (isNativeApp() || !isMobile()) { navigate(joinPath, { replace: true }); return; }
                setState({ loading: false, joinPath, ...d });
            })
            .catch(() => { if (alive) setState({ loading: false, error: true }); });
        return () => { alive = false; };
    }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

    const wrap = {
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.2rem', direction: 'rtl', fontFamily: 'Rubik, sans-serif',
        background: 'var(--bg, #070b16)', color: 'var(--text, #e8edf7)',
    };
    const card = {
        width: 'min(420px, 94vw)', background: 'var(--ink2, #0f1830)',
        border: '1px solid var(--bd2, rgba(255,255,255,0.12))', borderRadius: 20,
        padding: '1.6rem 1.4rem', boxShadow: '0 30px 80px -20px rgba(0,0,0,.9)', textAlign: 'center',
    };

    if (state.loading) {
        return <div style={wrap}><div style={card}>טוען…</div></div>;
    }
    if (state.error) {
        return (
            <div style={wrap}><div style={card}>
                <div style={{ fontSize: '2rem' }}>🤔</div>
                <h2 style={{ margin: '0.4rem 0' }}>קוד לא קיים</h2>
                <p style={{ color: 'var(--text-dim,#94a3b8)', fontSize: '0.9rem' }}>בדקו את הקוד עם המאמן או המנהל.</p>
            </div></div>
        );
    }

    const ios = isIOS();
    const storeHref = ios ? appStoreUrl() : playStoreUrl(state.code || code);
    const btn = {
        display: 'block', width: '100%', marginTop: '0.7rem', padding: '0.85rem', borderRadius: 12,
        border: 'none', fontWeight: 800, fontSize: '1rem', cursor: 'pointer', textDecoration: 'none',
    };

    return (
        <div style={wrap}>
            <div style={card}>
                <div style={{ fontSize: '2.2rem', marginBottom: '0.2rem' }}>📲</div>
                <h2 style={{ margin: '0 0 0.2rem', fontSize: '1.35rem' }}>הצטרפות ל{state.team}</h2>
                <p style={{ color: 'var(--text-dim,#94a3b8)', fontSize: '0.9rem', margin: '0 0 1rem' }}>
                    {state.clubName || ''}
                </p>

                <a href={storeHref} style={{ ...btn, background: 'linear-gradient(135deg,#34d399,#0d9488)', color: '#06281f' }}>
                    {ios ? '📥 התקן מ‑App Store' : '📥 התקן מ‑Google Play'}
                </a>
                <button
                    onClick={() => navigate(state.joinPath)}
                    style={{ ...btn, background: 'var(--glass-2, rgba(255,255,255,0.08))', color: 'var(--text,#e8edf7)', border: '1px solid var(--bd2, rgba(255,255,255,0.18))' }}
                >המשך בדפדפן (בלי התקנה)</button>

                {state.code && (
                    <div style={{ marginTop: '1.3rem', paddingTop: '1rem', borderTop: '1px dashed var(--bd2, rgba(255,255,255,0.18))' }}>
                        <div style={{ color: 'var(--text-dim,#94a3b8)', fontSize: '0.82rem', marginBottom: '0.4rem' }}>
                            אחרי ההתקנה, פתחו את האפליקציה והקלידו את הקוד:
                        </div>
                        <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.4rem', color: '#34d399' }}>
                            {state.code}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
