// Manager auth token (signed, club-scoped). Stored on login, sent on manager-only calls.
import { getActiveClub } from './clubConfig.js';

export const mgrToken = (slug) => localStorage.getItem('mgrToken:' + (slug || getActiveClub().slug)) || '';

// Spread into a fetch headers object for manager-only endpoints.
export const authHeaders = (slug) => {
    const t = mgrToken(slug);
    return t ? { 'x-club-token': t } : {};
};
