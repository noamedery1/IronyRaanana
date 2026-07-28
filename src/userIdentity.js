// Registered-user identity (member / operator), stored on the device. Trainers use their
// own trainerToken; managers use isAdmin. This covers the invite-based roles.
import { getActiveClub } from './clubConfig.js';
import { subscribeToPush } from './push.js';

export function getIdentity() {
    return {
        token: localStorage.getItem('userToken') || '',
        role: localStorage.getItem('userRole') || '',   // 'member' | 'operator'
        team: localStorage.getItem('userTeam') || '',    // the *active* team
        name: localStorage.getItem('userName') || '',
    };
}

// A parent can belong to more than one team (e.g. two kids). We keep a list of
// {team, token} memberships on the device; userTeam/userToken point at the active one.
export function getMemberships() {
    try {
        const raw = JSON.parse(localStorage.getItem('memberships') || '[]');
        if (Array.isArray(raw) && raw.length) return raw.filter((m) => m && m.team);
    } catch { /* fall through to legacy */ }
    // Legacy single-registration → synthesize one membership.
    const team = localStorage.getItem('userTeam');
    const token = localStorage.getItem('userToken');
    return team ? [{ team, token: token || '' }] : [];
}

export function setActiveTeam(team) {
    const m = getMemberships().find((x) => x.team === team);
    if (!m) return false;
    localStorage.setItem('userTeam', m.team);
    localStorage.setItem('userToken', m.token || '');
    return true;
}

// Add (or refresh) a membership without dropping existing ones, and make it active.
export function addMembership(d) {
    localStorage.setItem('userRole', d.role || 'member');
    if (d.name) localStorage.setItem('userName', d.name);
    const list = getMemberships();
    const existing = list.find((m) => m.team === d.team);
    if (existing) existing.token = d.token || existing.token;
    else if (d.team) list.push({ team: d.team, token: d.token || '' });
    localStorage.setItem('memberships', JSON.stringify(list));
    localStorage.setItem('userTeam', d.team || localStorage.getItem('userTeam') || '');
    localStorage.setItem('userToken', d.token || localStorage.getItem('userToken') || '');
}

export function setIdentity(d) {
    localStorage.setItem('userToken', d.token || '');
    localStorage.setItem('userRole', d.role || '');
    localStorage.setItem('userTeam', d.team || '');
    localStorage.setItem('userName', d.name || '');
}

export function clearIdentity() {
    ['userToken', 'userRole', 'userTeam', 'userName', 'memberships'].forEach((k) => localStorage.removeItem(k));
}

// Push segment this device should register under, by role.
export function pushSegmentFor(role, team) {
    if (role === 'operator') return '__OPERATOR__';
    if (role === 'member') return 'team:' + team;
    return '';
}

// Register this device for push according to the identity's role/team. Best-effort.
export async function registerIdentityPush(role, team) {
    const seg = pushSegmentFor(role, team);
    if (!seg) return { ok: false };
    return subscribeToPush(seg, getActiveClub().sheetApi);
}

// Validate the saved token with the server (returns null if none/invalid).
export async function loadIdentity() {
    const token = localStorage.getItem('userToken');
    if (!token) return null;
    try {
        const res = await fetch(`/api/${getActiveClub().slug}/users/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (data.valid) {
            setIdentity({ token, role: data.role, team: data.team, name: data.name });
            return data;
        }
    } catch {
        return getIdentity(); // offline: trust local
    }
    return null;
}
