// Run: node server/reminders.test.mjs
import assert from 'node:assert';
import { selectDue } from './reminders.js';

// `now` is a naive IL wall-clock Date — Thursday 2026-11-19 18:00.
const now = new Date(2026, 10, 19, 18, 0, 0);
const curWeek = { publication: { week_start: '2026-11-15' } }; // current week (Sun 11-15)

// Session 1.5h away → due. 3h away → not. 30min PAST → not.
const data1 = {
    ...curWeek,
    sessions: [
        { team: 'טרום ב', date: '2026-11-19', start_time: '19:30', type: 'training', hall: 'אולם א', day_of_week: 4 }, // +1.5h due
        { team: 'נוער', date: '2026-11-19', start_time: '21:00', type: 'training', day_of_week: 4 },                   // +3h not
        { team: 'ילדים', date: '2026-11-19', start_time: '17:30', type: 'training', day_of_week: 4 },                   // -0.5h past
    ],
};
const due1 = selectDue(data1, now);
assert.deepEqual(due1.map((d) => d.team), ['טרום ב'], 'only the session within 2h is due');
assert.equal(due1[0].key, 'טרום ב|2026-11-19|19:30', 'key format');

// Cancelled within the window → excluded.
const data2 = { ...curWeek, sessions: [{ team: 'טרום ב', date: '2026-11-19', start_time: '19:30', status: 'cancelled', day_of_week: 4 }] };
assert.equal(selectDue(data2, now).length, 0, 'cancelled session skipped');

// Recurring PAST-week publication: dates roll forward to the current week by day_of_week.
// Published week 2026-11-08 (past). Thursday session (dow=4) must roll to 2026-11-19 and be due at 19:30.
const dataPast = {
    publication: { week_start: '2026-11-08' },
    sessions: [{ team: 'טרום ב', date: '2026-11-12', start_time: '19:30', type: 'training', day_of_week: 4 }],
};
const dueRoll = selectDue(dataPast, now);
assert.deepEqual(dueRoll.map((d) => d.date), ['2026-11-19'], 'past-week session rolls forward to current week');

console.log('reminders.test.mjs: all passed');
