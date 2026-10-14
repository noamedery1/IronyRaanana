// Runnable self-check for the games/GK merge path (no framework): `node src/utils/scheduleMerge.test.mjs`.
// Covers the money logic: fuzzy team matching against fragmented PDF names, cell append/dedup,
// and GK text parsing. Exits non-zero on any failed assertion.
import assert from 'node:assert';
import { matchTeam, mergeEntries } from './scheduleMerge.js';
import { gkTextToEntries, gkWhatsApp } from './gkParse.js';

const teams = ["נוער", "נערים ב'", "נערים ב' צו פיוס", "ילדים א'", "טרום א' צפון"];

// Fuzzy match recovers pdfjs fragmentation (dropped leading letter, split spaces).
assert.equal(matchTeam('לדים א', teams), "ילדים א'", 'dropped-letter match');
assert.equal(matchTeam('ט רום א צפון', teams), "טרום א' צפון", 'split-space match');
assert.equal(matchTeam('נערים ב צו פיוס', teams), "נערים ב' צו פיוס", 'suffix team match');
assert.equal(matchTeam('נערים ב', teams), "נערים ב'", 'base vs suffix prefers base');
assert.equal(matchTeam('כדורסל חיפה', teams), '', 'no false match on a stranger');

// Merge appends to the right weekday cell (dayStart=2, dow=6 → col 8) and dedupes.
const rows = teams.map((t) => [t, '', '', '', '', '', '', '', '']);
const r1 = mergeEntries(rows, 2, [{ team: 'לדים א', dow: 6, line: '🏀 משחק 09:00' }]);
assert.equal(r1.unmatched.length, 0, 'matched');
assert.equal(r1.rows[3][8], '🏀 משחק 09:00', 'appended to ילדים א שבת cell');
const r2 = mergeEntries(r1.rows, 2, [{ team: 'ילדים א', dow: 6, line: '🏀 משחק 09:00' }]);
assert.equal(r2.rows[3][8], '🏀 משחק 09:00', 'identical line not duplicated');
const r3 = mergeEntries(rows, 2, [{ team: 'קבוצה לא קיימת', dow: 1, line: 'x' }]);
assert.equal(r3.unmatched.length, 1, 'unknown team → unmatched, not misplaced');

// GK text → entries (teams split on +, day from header) + tidy WhatsApp.
const gk = gkTextToEntries('אימון שוערים יום ראשון\nילדים א + ילדים ב\n16:00 - 16:30');
assert.equal(gk.dow, 0, 'day ראשון → dow 0');
assert.equal(gk.entries.length, 2, 'two teams split on +');
assert.equal(gk.entries[0].line, '🧤 אימון שוערים 16:00-16:30', 'gk line format');
assert.ok(gkWhatsApp(gk.entries, gk.dayName).includes('16:00-16:30 — ילדים א + ילדים ב'), 'whatsapp groups by time');

console.log('✓ scheduleMerge self-check passed');
