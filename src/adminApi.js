// Manager auth token (signed, club-scoped). Stored on login, sent on manager-only calls.
import { getActiveClub } from './clubConfig.js';

export const mgrToken = (slug) => localStorage.getItem('mgrToken:' + (slug || getActiveClub().slug)) || '';

// Return the stored manager token for a club ONLY if it is genuinely a manager token for THAT club:
// the token is an HMAC the server verifies, but its payload (base64url) is readable here, so we decode
// it and require role === 'manager' AND club === slug. This gates the manager UI strictly per-club —
// a manager of one club can never see another club's dashboard, nor get a "back to management" pill
// for it, even if a global isAdmin flag or a mis-keyed token is lying around. '' when not a match.
export function managerTokenFor(slug) {
    const s = slug || getActiveClub().slug;
    const raw = localStorage.getItem('mgrToken:' + s);
    if (!raw || !raw.includes('.')) return '';
    try {
        const b64 = raw.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        if (payload && payload.role === 'manager' && payload.club === s) return raw;
    } catch { /* malformed token → treat as no access */ }
    return '';
}
export const isManagerOf = (slug) => Boolean(managerTokenFor(slug));

// Spread into a fetch headers object for manager-only endpoints.
export const authHeaders = (slug) => {
    const t = mgrToken(slug);
    return t ? { 'x-club-token': t } : {};
};
