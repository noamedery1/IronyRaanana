// Run: node server/draftFold.test.mjs
// Covers foldFaGames — how the draft's auto-entered FA games survive a weekly-file import.
import assert from 'node:assert';
import { foldFaGames } from './draft.js';

const faGame = { team: 'טרום א', day_of_week: 5, type: 'match', note: '⚽ נגד מכבי תל אביב 09:00', start_time: '09:00' };
const fileGame = { team: 'טרום א', day_of_week: 5, type: 'match', note: 'משחק' };
const fileTrain = { team: 'טרום א', day_of_week: 4, type: 'training', note: 'אימון 17:00' };

const count = (arr, pred) => arr.filter(pred).length;
const isFa = (s) => s.note?.startsWith('⚽');
const slot = (s) => s.team === 'טרום א' && s.day_of_week === 5 && s.type === 'match';

// 1) No conflict (file leaves the FA slot empty) → FA game kept silently, training untouched.
let r = foldFaGames([fileTrain], [faGame]);
assert.equal(count(r, isFa), 1, 'no-conflict: FA game preserved');
assert.equal(count(r, (s) => s === fileTrain || s.note === 'אימון 17:00'), 1, 'no-conflict: training untouched');

// 2) Conflict, default (keep) → FA game wins, file's game dropped.
r = foldFaGames([fileGame], [faGame]);
assert.equal(count(r, slot), 1, 'keep: exactly one match at the slot');
assert.equal(count(r, isFa), 1, 'keep: it is the FA game');
assert.equal(count(r, (s) => s.note === 'משחק'), 0, 'keep: file game removed');

// 3) Conflict, overwrite → file's game wins, FA dropped.
r = foldFaGames([fileGame], [faGame], { 'טרוםא|5': 'overwrite' });
assert.equal(count(r, isFa), 0, 'overwrite: FA game dropped');
assert.equal(count(r, (s) => s.note === 'משחק'), 1, 'overwrite: file game kept');

// 4) Conflict, merge → both present.
r = foldFaGames([fileGame], [faGame], { 'טרוםא|5': 'merge' });
assert.equal(count(r, slot), 2, 'merge: both games at the slot');

// 5) File training at the FA slot's day (different type) is NOT a conflict → FA game kept.
r = foldFaGames([{ team: 'טרום א', day_of_week: 5, type: 'training', note: 'אימון' }], [faGame]);
assert.equal(count(r, isFa), 1, 'training-not-match: FA game preserved');

console.log('✓ draftFold: all passed');
process.exit(0);
