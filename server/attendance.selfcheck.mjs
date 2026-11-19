// Minimal self-check for the pure attendance logic. Run: node server/attendance.selfcheck.mjs
// (pg Pool doesn't open a connection until a query runs, so importing attendance.js here is safe.)
import assert from 'node:assert';
import { playerName, isLastMinute } from './attendance.js';

// playerName: player name wins when set, else the registered (parent) name. The roster SQL
// COALESCE(NULLIF(display_name,''),name) MUST resolve to the same string, or a child appears as both
// "coming" and "no-reply".
assert.equal(playerName({ name: 'אבא של דני', display_name: 'דני' }), 'דני');
assert.equal(playerName({ name: 'אבא של דני', display_name: '  ' }), 'אבא של דני'); // blank → fallback
assert.equal(playerName({ name: 'אבא של דני', display_name: null }), 'אבא של דני');
assert.equal(playerName({ name: 'דנה', display_name: 'דנה ' }), 'דנה'); // trimmed, same as roster NULLIF+trim
// The roster rule in words, to catch drift from the SQL:
const rosterRule = (r) => ((r.display_name || '').trim() || r.name); // == COALESCE(NULLIF(display_name,''),name)
for (const r of [{ name: 'p', display_name: 'c' }, { name: 'p', display_name: '' }, { name: 'p', display_name: '  x ' }])
    assert.equal(playerName(r), rosterRule(r));

// isLastMinute: only today + before kickoff + within window.
const now = { date: '2026-11-19', time: '17:00' };
assert.equal(isLastMinute('2026-11-19', '18:30', now, 3), true);   // 1.5h ahead
assert.equal(isLastMinute('2026-11-19', '21:00', now, 3), false);  // 4h ahead (outside window)
assert.equal(isLastMinute('2026-11-19', '16:00', now, 3), false);  // already started
assert.equal(isLastMinute('2026-11-20', '18:00', now, 3), false);  // not today

console.log('attendance self-check OK');
