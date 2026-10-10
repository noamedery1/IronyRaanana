import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { isNativeApp } from '../native.js';
import { isIOS } from '../inAppBrowser.js';
import { playStoreUrl, appStoreUrl } from '../appStores.js';
import { getMemberships, setActiveTeam } from '../userIdentity.js';
import { joinPathForCode } from '../joinRoute.js';

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
                // Already registered to this team on this device → straight to the schedule. (Member
                // codes only; operator/coach codes always route to their own flow.)
                const alreadyMember = d.role !== 'operator' && d.role !== 'coach' && d.role !== 'manager' && getMemberships().some((m) => m.team === d.team);
                const path = alreadyMember ? `/${d.clubSlug}` : joinPathForCode(d);
                if (alreadyMember) setActiveTeam(d.team);
                // A subdomain club lives on its own origin — land the parent there (full nav) so identity
                // and PWA state live on the right origin and the club always resolves server-side.
                const origin = (d.inviteOrigin || '').replace(/\/$/, '');
                const joinUrl = (origin && origin !== window.location.origin) ? origin + path : '';
                const goJoin = () => { if (joinUrl) window.location.href = joinUrl; else navigate(path, { replace: true }); };
                // In the app, or on a desktop browser → no store step; go straight in.
                if (isNativeApp() || !isMobile()) { goJoin(); return; }
                setState({ loading: false, goJoin, ...d });
            })
            .catch(() => { if (alive) setState({ loading: false, error: true }); });
        return () => { alive = false; };
    }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

    const wrap = {
        minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
    const codeVal = state.code || code;
    const storeHref = ios ? appStoreUrl() : playStoreUrl(codeVal);
    const btn = {
        display: 'block', width: '100%', marginTop: '0.7rem', padding: '0.85rem', borderRadius: 12,
        border: 'none', fontWeight: 800, fontSize: '1rem', cursor: 'pointer', textDecoration: 'none',
    };

    // Deferred-join: stash the code on the clipboard (on this tap gesture) before the store detour.
    // The installed app reads it once on first launch and auto-joins — neither iOS nor Android deliver
    // an install referrer. Best-effort; the code is also shown below to type manually either way.
    // Dual write: the async Clipboard API, plus a synchronous execCommand('copy') fallback for the
    // Android/WebView cases where the async API silently rejects without a strong user gesture.
    const writeClip = (text) => {
        try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', '');
            ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
            try { document.execCommand('copy'); } catch { /* ignore */ }
            document.body.removeChild(ta);
        } catch { /* ignore */ }
        try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text); } catch { /* ignore */ }
        return Promise.resolve();
    };
    const toStore = (e) => {
        if (e) e.preventDefault();
        const go = () => { window.location.href = storeHref; };
        try {
            Promise.resolve(writeClip('squadio:join:' + codeVal)).then(go, go);
            setTimeout(go, 500); // navigate even if the clipboard write stalls
        } catch { go(); }
    };

    return (
        <div style={wrap}>
            <div style={card}>
                <div style={{ fontSize: '2.2rem', marginBottom: '0.2rem' }}>📲</div>
                <h2 style={{ margin: '0 0 0.2rem', fontSize: '1.35rem' }}>
                    {state.role === 'operator' ? 'הצטרפות כמפעיל' : state.role === 'coach' ? 'כניסת מאמן' : state.role === 'manager' ? 'כניסת מנהל' : `הצטרפות ל${state.team}`}
                </h2>
                <p style={{ color: 'var(--text-dim,#94a3b8)', fontSize: '0.9rem', margin: '0 0 1rem' }}>
                    {state.clubName || ''}
                </p>

                <a href={storeHref} onClick={toStore} style={{ ...btn, background: 'linear-gradient(135deg,#34d399,#0d9488)', color: '#06281f' }}>
                    {ios ? '📥 התקן מ‑App Store' : '📥 התקן מ‑Google Play'}
                </a>
                <button
                    onClick={() => state.goJoin && state.goJoin()}
                    style={{ ...btn, background: 'var(--glass-2, rgba(255,255,255,0.08))', color: 'var(--text,#e8edf7)', border: '1px solid var(--bd2, rgba(255,255,255,0.18))' }}
                >המשך בדפדפן (בלי התקנה)</button>

                {/* Member + operator codes are re-typed after install to reach their join flow, so show the
                    code. Coach/manager route to a login screen (personal credentials, not this code) → hide. */}
                {codeVal && state.role !== 'coach' && state.role !== 'manager' && (
                    <div style={{ marginTop: '1.3rem', paddingTop: '1rem', borderTop: '1px dashed var(--bd2, rgba(255,255,255,0.18))' }}>
                        <div style={{ color: 'var(--text-dim,#94a3b8)', fontSize: '0.82rem', marginBottom: '0.4rem' }}>
                            אחרי ההתקנה, פתחו את האפליקציה והקלידו את הקוד:
                        </div>
                        <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '2rem', letterSpacing: '0.4rem', color: '#34d399' }}>
                            {codeVal}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
