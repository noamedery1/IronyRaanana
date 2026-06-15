// Registered-user identity (member / operator), stored on the device. Trainers use their
// own trainerToken; managers use isAdmin. This covers the invite-based roles.
import { getActiveClub } from './clubConfig.js';
import { subscribeToPush } from './push.js';

export function getIdentity() {
    return {
        token: localStorage.getItem('userToken') || '',
        role: localStorage.getItem('userRole') || '',   // 'member' | 'operator'
        team: localStorage.getItem('userTeam') || '',
        name: localStorage.getItem('userName') || '',
    };
}

export function setIdentity(d) {
    localStorage.setItem('userToken', d.token || '');
    localStorage.setItem('userRole', d.role || '');
    localStorage.setItem('userTeam', d.team || '');
    localStorage.setItem('userName', d.name || '');
}

export function clearIdentity() {
    ['userToken', 'userRole', 'userTeam', 'userName'].forEach((k) => localStorage.removeItem(k));
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
        const res = await fetch(getActiveClub().sheetApi, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'userAuth', token }),
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
