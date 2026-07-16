// Sport-aware venue wording. A football club trains on a מגרש; a basketball club
// in an אולם. Driven by the active club's `sport` (set in the superuser console).
// Falls back to אולם/אולמות so the existing basketball club (raanana) is unchanged.
import { getActiveClub } from './clubConfig.js';

const MAP = {
    football: { one: 'מגרש', many: 'מגרשים' },
    soccer: { one: 'מגרש', many: 'מגרשים' },
    basketball: { one: 'אולם', many: 'אולמות' },
    handball: { one: 'אולם', many: 'אולמות' },
    volleyball: { one: 'אולם', many: 'אולמות' },
};

export function venueLabels(sport) {
    const s = String(sport ?? getActiveClub()?.sport ?? '').toLowerCase().trim();
    return MAP[s] || MAP.basketball;
}

// Singular ("מגרש"/"אולם") and plural ("מגרשים"/"אולמות") for the active (or given) sport.
export const venue = (sport) => venueLabels(sport).one;
export const venues = (sport) => venueLabels(sport).many;

// Decorative sport icon used where there's no uploaded club logo to show.
const EMOJI = {
    football: '⚽', soccer: '⚽', basketball: '🏀', handball: '🤾',
    volleyball: '🏐', tennis: '🎾', swimming: '🏊', athletics: '🏃',
};

export function sportEmoji(sport) {
    const s = String(sport ?? getActiveClub()?.sport ?? '').toLowerCase().trim();
    return EMOJI[s] || '🏆';
}

// Common sports offered in the superuser club form (value = stored sport key).
export const SPORTS = [
    { value: 'football', label: 'כדורגל ⚽' },
    { value: 'basketball', label: 'כדורסל 🏀' },
    { value: 'handball', label: 'כדוריד 🤾' },
    { value: 'volleyball', label: 'כדורעף 🏐' },
    { value: 'tennis', label: 'טניס 🎾' },
    { value: 'swimming', label: 'שחייה 🏊' },
    { value: 'athletics', label: 'אתלטיקה 🏃' },
];
