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
    ['userToken', 'userRole', 'userTeam', 'userName', 'memberships', 'operatorToken'].forEach((k) => localStorage.removeItem(k));
}

// ===== Dual identity (parent + operator on the same device) =====
// A device can hold BOTH a parent (member) identity and an operator one — e.g. a parent who later
// opens an operator link. The operator token is preserved separately (see main.jsx) so the two can
// be switched between losslessly without re-opening a link.

export function getOperatorToken() {
    return localStorage.getItem('operatorToken') || '';
}

// Flip the ACTIVE identity to the preserved operator identity. Returns false if there is none.
export function switchToOperator() {
    const tok = getOperatorToken();
    if (!tok) return false;
    localStorage.setItem('userToken', tok);
    localStorage.setItem('userRole', 'operator');
    localStorage.removeItem('userTeam'); // operator sees the full board — no single active team
    return true;
}

// Flip the ACTIVE identity back to the parent (member) identity, activating one of their teams
// (the named one, else the first). Returns false if there are no memberships.
export function switchToMember(team) {
    const list = getMemberships();
    if (!list.length) return false;
    const pick = list.find((m) => m.team === team) || list[0];
    localStorage.setItem('userRole', 'member');
    localStorage.setItem('userTeam', pick.team);
    localStorage.setItem('userToken', pick.token || '');
    return true;
}

// Remove the operator identity from THIS device only (local). The server account is left intact, so
// the same operator link still works on the operator's other devices — this just stops showing and
// using the operator here. If operator was the active role, fall back to a team, else clear.
export function removeOperator() {
    localStorage.removeItem('operatorToken');
    if ((localStorage.getItem('userRole') || '') === 'operator') {
        if (getMemberships().length) switchToMember();
        else clearIdentity();
    }
}

// Remove ONE team membership from this device (e.g. a child who left the team). If the removed team
// was the active one, repoint to another team, else fall back to the operator identity, else clear.
export function removeMembership(team) {
    const list = getMemberships().filter((m) => m.team !== team);
    localStorage.setItem('memberships', JSON.stringify(list));
    if ((localStorage.getItem('userTeam') || '') === team) {
        if (list.length) {
            localStorage.setItem('userTeam', list[0].team);
            localStorage.setItem('userToken', list[0].token || '');
            localStorage.setItem('userRole', 'member');
        } else if (getOperatorToken()) {
            switchToOperator();
        } else {
            clearIdentity();
        }
    }
    return list;
}

// Push segment this device should register under, by role.
export function pushSegmentFor(role, team) {
    if (role === 'operator') return '__OPERATOR__';
    if (role === 'member') return 'team:' + team;
    return '';
}

// The FULL push segment for this device: a member gets all their teams (one "team:<name>" per
// line) so a single device receives pushes for every team they belong to — tied to their real
// memberships, not whichever tab was open. `validTeamNames` (the current club's teams) scopes it
// to this club, since a subscription is stored per club and memberships aren't club-separated.
export function membershipSegment(validTeamNames) {
    const role = localStorage.getItem('userRole');
    if (role === 'operator') return '__OPERATOR__';
    if (role === 'member') {
        let teams = getMemberships().map((m) => m.team).filter(Boolean);
        if (validTeamNames && validTeamNames.length) {
            const ok = new Set(validTeamNames);
            teams = teams.filter((t) => ok.has(t));
        }
        return [...new Set(teams)].map((t) => 'team:' + t).join('\n');
    }
    return '';
}

// Register this device for push based on the identity's memberships IN THE CURRENT CLUB. Best-effort.
export async function registerIdentityPush() {
    const role = localStorage.getItem('userRole');
    const slug = getActiveClub().slug;
    if (role === 'operator') return subscribeToPush('__OPERATOR__', getActiveClub().sheetApi);
    if (role !== 'member') return { ok: false };
    let valid = null;
    try { const d = await fetch(`/api/${slug}/teams`).then((r) => r.json()); valid = (d.teams || []).map((t) => t.name); } catch { /* fall back to all */ }
    const seg = membershipSegment(valid);
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
