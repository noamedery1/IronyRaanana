// Runnable self-check for the FA-games pure logic (no framework, no DB):
//   node server/faGames.test.mjs
// Covers the money logic: time-finalized detection, date parsing, stable keys, team mapping
// (league 1:1 + cup-by-name), our-side extraction, and the notify threshold. Exits non-zero on fail.
import assert from 'node:assert';
import { norm, timeSet, faDateToYMD, faKey, ourSide, opponentOf, homeAway, mapTeam, shouldNotify, faNote } from './faGames.js';

// The real Hapoel Raanana league map (confirmed with the club).
const leagueMap = {
    'ליגת העל לנוער': 'נוער',
    "נערים א' על": "נערים א'",
    "נערים ב' על": "נערים ב'",
    "נערים ב' לאומית דרום": 'נערים ב צו פיוס',
    "נערים ג' על": "נערים ג'",
    "נערים ג' לאומית דרום": 'נערים ג צו פיוס',
    "ליגת ילדים א' מרכז": "ילדים א'",
    "ליגת ילדים א' שרון 1": 'ילדים א צו פיוס',
    "ליגת ילדים ב' מרכז": "ילדים ב'",
    "ליגת ילדים ב' שרון 1": 'ילדים ב צו פיוס',
    "ליגת ילדים ג' מרכז": "ילדים ג'",
    "ליגת ילדים ג' שרון 1": "ילדים ג' צפון",
    "ליגת ילדים טרום א' שרון": "טרום א'",
    "ליגת ילדים טרום א' שרון 1": "טרום א' צפון",
    "ליגת ילדים טרום ב' שרון": "טרום ב'",
};
const nameMap = { "הפ' רעננה רועי": 'נוער', 'הפועל רעננה אור': "טרום א'" };

// ---- timeSet: "00:00"/"" = not set yet ----
assert.equal(timeSet('19:00'), true);
assert.equal(timeSet('9:30'), true);
assert.equal(timeSet('00:00'), false, 'FA 00:00 means time not set');
assert.equal(timeSet(''), false);
assert.equal(timeSet('טרם נקבעה'), false);

// ---- date parsing dd/mm/yy -> YMD ----
assert.equal(faDateToYMD('19/10/26'), '2026-10-19');
assert.equal(faDateToYMD('1/1/27'), '2027-01-01');
assert.equal(faDateToYMD(''), null);

// ---- stable keys: real id when present, else deterministic hash ----
assert.equal(faKey({ Id: 1120873 }), 'id:1120873');
const k1 = faKey({ Id: -1, LeagueName: "גביע ילדים ג' ע\"ש X", Round: 2, GameName: 'הפועל רעננה - שמשון' });
const k2 = faKey({ Id: -1, LeagueName: "גביע ילדים ג' ע\"ש X", Round: 2, GameName: 'הפועל רעננה - שמשון' });
assert.equal(k1, k2, 'same fixture -> same key');
assert.notEqual(k1, faKey({ Id: -1, LeagueName: 'X', Round: 3, GameName: 'הפועל רעננה - שמשון' }), 'round differs -> key differs');

// ---- our-side / opponent / home-away ----
assert.equal(ourSide('הפועל רעננה - בני יהודה ת"א'), 'הפועל רעננה');
assert.equal(ourSide('הפועל עכו - הפועל רעננה'), 'הפועל רעננה');
assert.equal(opponentOf('הפועל רעננה - בני יהודה ת"א'), 'בני יהודה ת"א');
assert.equal(opponentOf('הפועל עכו - הפועל רעננה'), 'הפועל עכו');
assert.equal(homeAway('הפועל רעננה - בני יהודה ת"א'), 'בית');
assert.equal(homeAway('הפועל עכו - הפועל רעננה'), 'חוץ');

// ---- team mapping: league 1:1 (real games from the FA API) ----
assert.equal(mapTeam({ LeagueName: 'ליגת העל לנוער', GameName: "מכבי הרצליה - הפ' רעננה רועי" }, leagueMap), 'נוער');
assert.equal(mapTeam({ LeagueName: "ליגת ילדים א' מרכז", GameName: 'הפועל ר"ג - הפועל רעננה "צו פיוס"' }, leagueMap), "ילדים א'");
assert.equal(mapTeam({ LeagueName: "ליגת ילדים א' שרון 1", GameName: 'הפועל רעננה 2 "צו פיוס" - הפועל א.א. פאחם' }, leagueMap), 'ילדים א צו פיוס', 'the two ילדים-א teams resolve by league, not name');
// Apostrophe style must not matter (FA uses ASCII ', our board a geresh).
assert.equal(mapTeam({ LeagueName: "נערים א׳ על", GameName: 'X - הפועל רעננה' }, leagueMap), "נערים א'", 'geresh vs ascii apostrophe still maps');
// Senior team has no youth mapping -> unmapped (no notifications, per the club).
assert.equal(mapTeam({ LeagueName: 'ליגה לאומית', GameName: 'הפועל רעננה - בני יהודה' }, leagueMap), '', 'senior team unmapped');
// Cup: league name isn't 1:1, fall back to the name map.
assert.equal(mapTeam({ LeagueName: 'גביע לנוער', GameName: "חופשית - הפ' רעננה רועי" }, leagueMap, nameMap), 'נוער', 'cup resolves by name map');

// ---- notify threshold ----
assert.equal(shouldNotify(null, null, '2026-10-24', '00:00'), false, 'date-only never alerts');
assert.equal(shouldNotify(null, null, '2026-10-24', '11:00'), true, 'time newly set alerts');
assert.equal(shouldNotify('2026-10-24', '11:00', '2026-10-24', '11:00'), false, 'unchanged does not re-alert');
assert.equal(shouldNotify('2026-10-24', '11:00', '2026-10-24', '13:00'), true, 'time change alerts');
assert.equal(shouldNotify('2026-10-24', '11:00', '2026-10-25', '11:00'), true, 'date change alerts');

// ---- board note format (amber game card) ----
assert.equal(
    faNote({ game_time: '19:00', opponent: 'בני יהודה', home_away: 'בית', field: 'הרצליה אצטדיון טוטו' }),
    '⚽ משחק 19:00 נגד בני יהודה (בית) · הרצליה אצטדיון טוטו',
);
assert.equal(faNote({ game_time: '11:00', opponent: 'שמשון', home_away: '', field: '' }), '⚽ משחק 11:00 נגד שמשון');

assert.equal(norm("נערים א׳"), 'נערים א');
console.log('✓ faGames self-check passed');
